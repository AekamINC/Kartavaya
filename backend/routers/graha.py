"""
graha.py — Graha · ग्रह (CRM) Router
Contacts, deals, pipelines, activities.
"""
import asyncio
import io
import json
import logging
import math
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role, is_org_admin
from middleware.role_tiers import ORG_MANAGEMENT_ROLES, held_module_levels
from middleware.subscription import require_any_module, require_module
from limiter import limiter
from services.audit_actors import actor_joins, actor_select
from services.contact_dedupe import find_duplicates, merge_contacts, undo_merge
from services.lead_parser import parse_lead_email
# Imported as a MODULE, not as loose names: three of its statements are SQL
# constants that `tests/test_territory_routing.py` PREPAREs against the live
# schema, and a reader of `territory_routing.PIN_LADDER_ALL` can see at a glance
# that the statement is defined once, over there, beside the rule it implements.
from services import territory_routing
# Phase 7.3. Imported as a MODULE for the same reason, and for one more: its
# `CLAIMED_PINS_SQL` is PREPAREd against the live schema by
# `tests/test_pin_boundaries.py`, which deliberately does not name this router —
# see the note on that constant.
from services import pin_boundaries
from services import recycle_bin as bin_svc
from services import digipin
from utils import assert_file_url

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/graha", tags=["graha-crm"])

_gate = require_module("graha")

#: The CLIENT and CONTACT routes, and only those. Everything else in this file
#: stays on `_gate` above.
#:
#: ── WHY TWO GATES IN ONE ROUTER ─────────────────────────────────────────────
#: `staging.graha_clients` is not a CRM record that other modules borrow. It is
#: THE company record for the whole product — `ganit_invoices` bills it,
#: `vikray_orders.client_id` points at it, and `graha_contacts.client_id` is how
#: a person is attached to it. Three modules own the same object and one of them
#: happened to be the one whose router the endpoints live in, so a firm that
#: bought Ganit but not the CRM got a 403 on its own customer list and had no
#: way to add a customer at all. `routers/vikray.py:37` already carries a second
#: gate for the mirror-image reason.
#:
#: ── WHAT THIS DOES NOT WIDEN ────────────────────────────────────────────────
#: Deals, pipelines, the kanban, follow-ups, activities, labels, lead scoring,
#: territories, web forms, inbound leads, dedupe, approvals, documents, custom
#: fields and every report remain `graha`-only. Those are the CRM's own working
#: objects, not the company record, and nothing in Ganit or Vikray needs them.
#: The contact DETAIL route is widened and answers with that contact's deals,
#: follow-ups, activities and labels; that is one org reading its own contact's
#: history, and the CRM surfaces that act on those objects stay refused.
_crm_entity_gate = require_any_module(
    "graha", "ganit", "vikray",
    # Named for the data, not for the three SKUs. See `_nearest_refusal`.
    subject="clients and contacts",
)


def _listed(rows, limit: int) -> dict:
    """Wrap a capped list so the caller can tell a full page from a truncated one.

    F4 (b). Every list in this router caps at a hardcoded LIMIT and returned only
    the rows, so a client had no way to know whether it held all of them. The
    consequence was measured on staging: the pipeline screen reported "199 deals
    have no next step" against a true 510, because it computed a total from a
    list that had already been cut to 200.

    The count rides along as `_total` from a `COUNT(*) OVER()` window in the same
    query, so it is computed over exactly the rows the filters selected. It is
    stripped from each row here — it is metadata about the response, not a field
    of a deal, and leaking it would put an underscore-prefixed key in every
    record the frontend maps over.

    `truncated` is the flag worth reading: `total > limit` is the condition that
    makes any client-side aggregate wrong, and stating it once here means each
    screen does not re-derive it.
    """
    out = [dict(r) for r in rows]
    total = int(out[0].pop("_total", len(out))) if out else 0
    for r in out[1:]:
        r.pop("_total", None)
    return {"data": out, "total": total, "limit": limit, "truncated": total > limit}


#: The display name of a person, as SQL, aliased `u`.
#:
#: It stops at `name` and NEVER reaches `u.email`. The owner ruled on
#: 2026-08-23 that a display ladder must not end at an email address — it is a
#: contact detail rendered as a label, and it inverts the rule that Aekam must
#: not see a customer's member emails. `tests/test_audit_actors.py` walks the
#: whole backend refusing any ladder that does.
#:
#: `'Unnamed member'` rather than NULL, so a LEFT JOIN that finds nothing still
#: prints something a person can read. Measured before the email rung came off:
#: 0 of 35 live accounts have neither `full_name` nor `name`, so the fallback
#: has never fired on real data.
#:
#: Held here because the same expression is written out in six places in this
#: file and a seventh would be the one that drifts.
_USER_NAME_SQL = (
    "COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), "
    "'Unnamed member')"
)


# ── Pydantic Models ──────────────────────────────────────────

class ContactCreate(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    company: str = ""
    designation: str = ""
    gstin: str = ""
    pan: str = ""
    billing_address: dict = {}
    shipping_address: dict = {}
    tags: list[str] = []
    notes: str = ""
    contact_type: str = "lead"
    source: str = ""
    client_id: str = ""
    #: WHICH SALES PATCH this person falls in — `graha_contacts.territory_id`.
    #: The column has existed since migration 023 and was UNREACHABLE FROM EVERY
    #: API PATH until 2026-08-27: not on this model, not on `ContactUpdate`, and
    #: in neither the INSERT nor the PATCH SET-build. `graha_deals.territory_id`
    #: was always writable, so a deal could carry a territory and the person it
    #: belongs to could not. Live at the time: 0 of 289 contacts routed.
    territory_id: str = ""
    #: The org's own extra fields, keyed by `graha_custom_fields.id`. The column
    #: and the definitions table have both existed since migration 023; nothing
    #: ever wrote to it, which is why a field created in the Custom Fields tab
    #: never appeared on a form.
    custom_data: dict = {}


class ContactMerge(BaseModel):
    merge_ids: list[UUID]


class ContactUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    designation: str | None = None
    gstin: str | None = None
    pan: str | None = None
    billing_address: dict | None = None
    shipping_address: dict | None = None
    tags: list[str] | None = None
    notes: str | None = None
    contact_type: str | None = None
    source: str | None = None
    lead_score: int | None = None
    lead_score_reasons: list[str] | None = None
    assigned_to: str | None = None
    client_id: str | None = None
    #: See `ContactCreate.territory_id`. `""` clears the territory, the same
    #: deliberate "none" value `client_id` uses, and is bound through the same
    #: `NULLIF($n,'')::uuid` in the SET-build below.
    territory_id: str | None = None
    custom_data: dict | None = None


class DealCreate(BaseModel):
    title: str
    contact_id: str = ""
    client_id: str = ""
    pipeline_id: str = ""
    value: float = 0
    stage: str = "New"
    probability: int = 0
    expected_close_date: str = ""
    assigned_to: str = ""
    notes: str = ""
    tags: list[str] = []
    #: DealUpdate already carried this and `_DEAL_COLS` already wrote it; only
    #: CREATE could not, so a custom field filled in on the new-deal form was
    #: dropped and had to be re-entered on the edit panel.
    custom_data: dict = {}
    #: Same story: the column has existed since migration 023 and `_DEAL_COLS`
    #: writes it, but no create path could set it and no screen could read it,
    #: so a territory could be defined and never used.
    territory_id: str = ""


class DealUpdate(BaseModel):
    title: str | None = None
    stage: str | None = None
    value: float | None = None
    probability: int | None = None
    expected_close_date: str | None = None
    assigned_to: str | None = None
    client_id: str | None = None
    #: `_DEAL_COLS` has listed this column since the beginning and NO request
    #: model carried it, so the person a deal is about was unchangeable from
    #: every client in the product. The column was writable and unreachable.
    contact_id: str | None = None
    notes: str | None = None
    tags: list[str] | None = None
    won_at: str | None = None
    lost_at: str | None = None
    #: ── THE FIELD THAT EXISTED AND WAS THROWN AWAY ─────────────────────────
    #:
    #: This has been on the model since the beginning and was MISSING from
    #: `_DEAL_COLS`, which is the opposite fault to `territory_id` below and
    #: does more damage, because it fails in the direction that looks like
    #: success. A person moves a deal to Lost, types why, saves; the PATCH is
    #: accepted, 200, the drawer closes, and the dict comprehension that builds
    #: `updates` has already dropped the value on the floor. Nothing errors and
    #: nothing is written. Live control on 27 Aug: 22 deals stand in stage
    #: `Lost` and 2 carry a `lost_reason` — and neither of those two can have
    #: come through this route, because no request has ever been able to set it.
    #:
    #: It is also the single most valuable free-text field in the module. "Why
    #: are we losing?" is the question the CRM exists to answer, and the answer
    #: was being discarded silently for the entire life of the product.
    #:
    #: `""` is a legitimate value here and clears the reason. It falls to the
    #: generic bare-`$n` branch of the SET-build on purpose: the column is
    #: `text`, so the parameter type is unambiguous and this is NOT the untyped-
    #: into-`uuid` shape that PgBouncer turns into an instant 500.
    lost_reason: str | None = None
    #: ── TWO MORE DEAD ALLOWLIST ENTRIES, BOTH GIVEN A FIELD ────────────────
    #:
    #: `custom_data` and `pipeline_id` were both listed in `_DEAL_COLS` with no
    #: field behind them, so neither entry could ever match anything
    #: `body.dict(exclude_unset=True)` produced. Same precedent as
    #: `territory_id`, same resolution, and the reason is the same in both:
    #:
    #: · `custom_data` is settable at create (`DealCreate` grew the field for
    #:   exactly this reason) and would otherwise be frozen from that moment on
    #:   — a per-org custom field that can be filled in once, wrongly, for ever.
    #: · `pipeline_id` is the board the deal lives on. Deals get moved between
    #:   pipelines; that is what pipelines are for. Deleting the entry would
    #:   make the board a deal was first filed on permanent, and "delete it and
    #:   raise it again" is not a move — it loses the activities, the follow-ups
    #:   and the `deal.created` history hanging off the id.
    #:
    #: `pipeline_id` is routed through `resolve_deal_pipeline` and bound
    #: `NULLIF($n,'')::uuid` in the SET-build, NOT left to the generic branch,
    #: for the `uuid`-column reason `territory_id` records below. Unlike the
    #: other three ids it is NOT clearable — see `update_deal`.
    custom_data: dict | None = None
    pipeline_id: str | None = None
    #: ── THE DEAD ALLOWLIST ENTRY, RESOLVED BY ADDING THE FIELD ─────────────
    #:
    #: `_DEAL_COLS` in `update_deal` has listed `territory_id` since the
    #: beginning and this model had no such field, so the entry could never
    #: match anything `body.dict(exclude_unset=True)` produced — a permission
    #: to write a column that no request could ask for.
    #:
    #: Two ways to end that, and this is the one chosen. Deleting the entry
    #: would have made a deal's territory settable exactly once, at create, and
    #: then unchangeable from every client in the product for ever — the same
    #: "writable and unreachable" shape as `contact_id` four lines up, which
    #: this very model had to grow a field to fix. A territory is a rule that
    #: gets redrawn: patches get split, a region is handed to a new rep, and a
    #: deal filed under the old one has to be able to move. Correcting it by
    #: deleting the deal is not a correction.
    #:
    #: `""` clears it, and it is routed through `resolve_contact_territory` and
    #: bound `NULLIF($n,'')::uuid` in the SET-build — NOT left to fall to the
    #: generic bare-`$n` branch, which is an untyped parameter into a `uuid`
    #: column and the instant PgBouncer 500.
    territory_id: str | None = None


class PipelineCreate(BaseModel):
    name: str
    stages: list[str] = ["New", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]


class ActivityCreate(BaseModel):
    deal_id: str = ""
    contact_id: str = ""
    activity_type: str = "note"
    title: str
    description: str = ""
    scheduled_at: str = ""


class FollowUpCreate(BaseModel):
    title: str
    description: str = ""
    due_at: str
    remind_at: str = ""
    contact_id: str = ""
    deal_id: str = ""
    assigned_to: str = ""


class LabelCreate(BaseModel):
    name: str
    color: str = "#6366f1"


class ClientCreate(BaseModel):
    name: str
    ref_no: str = ""
    gstin: str = ""
    address: dict = {}
    website: str = ""
    notes: str = ""
    tags: list[str] = []


class ClientUpdate(BaseModel):
    name: str | None = None
    ref_no: str | None = None
    gstin: str | None = None
    address: dict | None = None
    website: str | None = None
    notes: str | None = None
    tags: list[str] | None = None


# ── Clients (Company entity) ────────────────────────────────

@router.get("/clients")
async def list_clients(
    search: Optional[str] = None,
    since: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    """Companies — or, with `?since=`, only those changed since that moment.

    The delta drops the `is_active=TRUE` filter: a company deactivated since the
    last sync is a CHANGE the device has to hear about, and filtering it out is
    how the phone keeps showing a company the web deleted. The client removes
    any row it receives with `is_active=false`. See `services/delta_sync`.
    """
    from services.delta_sync import envelope, parse_since

    since_dt = parse_since(since)
    synced_at = datetime.now(timezone.utc)
    pool = await get_pool()
    query = (
        "SELECT cl.*, "
        "(SELECT COUNT(*) FROM public.graha_contacts WHERE client_id=cl.id AND is_active=TRUE) AS contact_count, "
        "(SELECT COUNT(*) FROM public.graha_deals WHERE client_id=cl.id AND is_active=TRUE) AS deal_count, "
        # Who created this company and who last touched it, BY NAME. `cl.*`
        # above already ships `created_by`/`updated_by`, but those are
        # `users.user_id` TEXT — a member id, which is the one thing no screen
        # may render. `actor_select` resolves both to a display name and adds
        # the `has_creator`/`has_updater` booleans that let the UI tell "nobody
        # is recorded" (em dash) apart from "there is an id but the account is
        # gone" (unknown). Written here rather than by hand because the
        # hand-written copy in `list_activities` below is what drifted into
        # printing an email address; see `services/audit_actors`.
        + actor_select("cl", updated=True) +
        "COUNT(*) OVER() AS _total FROM public.graha_clients cl "
        # After the FROM and before the WHERE. Neither fragment carries a `$n`,
        # so the `$1::uuid` below and every `${n}` appended after it keep the
        # numbering they had.
        + actor_joins("cl", updated=True) +
        "WHERE cl.org_id=$1::uuid "
        + ("" if since_dt is not None else "AND cl.is_active=TRUE ")
    )
    params: list = [org_id]
    if search:
        params.append(search)
        n = len(params)
        query += (f"AND (cl.name ILIKE '%' || ${n} || '%' OR cl.ref_no ILIKE '%' || ${n} || '%' "
                  f"OR cl.gstin ILIKE '%' || ${n} || '%') ")
    if since_dt is not None:
        params.append(since_dt)
        query += f"AND cl.updated_at > ${len(params)} ORDER BY cl.updated_at ASC LIMIT 200"
    else:
        query += "ORDER BY cl.created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    if since_dt is not None:
        return envelope([dict(r) for r in rows], since_dt, synced_at, limit=200)
    return _listed(rows, limit=200)


@router.post("/clients")
async def create_client(
    body: ClientCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    pool = await get_pool()
    # The write and its `client.created` event share ONE transaction — the
    # create_contact contract: the event exists if and only if the company row
    # committed, and a rollback takes both.
    #
    # `RETURNING *` rather than the three columns the response needs, because
    # `client_created` reads `gstin` (rendered to a bool, never the value) and
    # `created_by` for the payload. The RESPONSE is built explicitly below so
    # its shape is unchanged by the widening.
    from services.niyam.subjects import client_created
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "INSERT INTO public.graha_clients "
                "(org_id, name, ref_no, gstin, address, website, notes, tags, created_by) "
                "VALUES ($1::uuid, $2, NULLIF($3,''), NULLIF($4,''), $5, NULLIF($6,''), NULLIF($7,''), $8, $9) "
                "RETURNING *",
                org_id, body.name, body.ref_no, body.gstin,
                json.dumps(body.address), body.website, body.notes,
                body.tags, user["user_id"],
            )
            await client_created(_conn, org_id=org_id, actor_id=user["user_id"],
                                 client_id=row["id"], row=dict(row))
    return {"status": "created", "id": row["id"], "name": row["name"],
            "ref_no": row["ref_no"]}


def _with_digipin(row) -> dict:
    """A record row plus its DIGIPIN. Phase 8.4.

    ── DERIVED, NEVER STORED ────────────────────────────────────────────────

    There is deliberately no `digipin` COLUMN on either table. It is a pure
    function of `lat`/`lng` with no vendor, no API call and no key, so a stored
    copy would buy nothing and could fall out of step with the coordinate it
    came from — and a DIGIPIN that disagrees with its own coordinate is worse
    than none, because both look right.

    ── AND NOT COMPUTED IN THE BROWSER ──────────────────────────────────────

    A JS copy would WORK, which is the trap. Two implementations of a ten-level
    grid traversal drift at the last symbol or two while agreeing perfectly at
    level 6, so the divergence shows up as two systems naming NEIGHBOURING 4 m
    cells rather than as anything that looks like a bug.
    `services/digipin.py` is checked symbol-for-symbol against India Post's own
    reference implementation over 20,000 coordinates; serving the result keeps
    that the only implementation in the product.

    ── `None` IS A REAL ANSWER ──────────────────────────────────────────────

    The grid covers lat 2.5-38.5 and lng 63.5-99.5. A coordinate outside it HAS
    no DIGIPIN, so `encode_or_none` and not `encode`: inventing a code for a
    point the grid does not cover would be a confident lie about a ~4 m cell.

    One helper rather than the expression written at each call site — this is
    the second route to need it and there will be more, and the reason `None`
    is returned is not something to re-derive from a one-line condition.
    """
    d = dict(row)
    lat, lng = d.get("lat"), d.get("lng")
    # `numeric` arrives as `Decimal`; `encode` takes floats. Both-or-neither is
    # guaranteed by `*_geo_complete_ck`, but this does not lean on that — a
    # constraint is about what the DATABASE will store, and this function is
    # also handed rows from joins and from older code paths.
    d["digipin"] = (digipin.encode_or_none(float(lat), float(lng))
                    if lat is not None and lng is not None else None)
    return d


@router.get("/clients/{client_id}")
async def get_client(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM public.graha_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        str(client_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Client not found")
    contacts = await pool.fetch(
        "SELECT id, name, email, phone, designation, contact_type FROM public.graha_contacts "
        "WHERE client_id=$1::uuid AND is_active=TRUE ORDER BY name",
        str(client_id),
    )
    deals = await pool.fetch(
        "SELECT id, title, value, stage FROM public.graha_deals "
        "WHERE client_id=$1::uuid AND is_active=TRUE ORDER BY created_at DESC LIMIT 50",
        str(client_id),
    )
    return {
        **_with_digipin(row),
        "contacts": [dict(c) for c in contacts],
        "deals": [dict(d) for d in deals],
    }


@router.patch("/clients/{client_id}")
async def update_client(
    client_id: UUID,
    body: ClientUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    pool = await get_pool()
    sets, vals, idx = [], [], 1
    for field in ("name", "ref_no", "gstin", "website", "notes", "tags"):
        v = getattr(body, field, None)
        if v is not None:
            idx += 1
            sets.append(f"{field}=${idx}")
            vals.append(v)
    if body.address is not None:
        idx += 1
        sets.append(f"address=${idx}")
        vals.append(json.dumps(body.address))
    if not sets:
        raise HTTPException(400, "Nothing to update")
    sets.append("updated_at=NOW()")
    # WHO, in the same statement as WHEN. Two statements would let the stamp
    # and the actor disagree — a crash between them leaves `updated_at` moved
    # and `updated_by` still naming the PREVIOUS editor, which is worse than no
    # audit column at all because it reads as a confident answer. `idx` is
    # advanced first so this takes the next free placeholder and `org_id`
    # slides to `idx + 1`; the bind order below matches because `vals` is
    # appended in the same order the numbers were handed out.
    idx += 1
    sets.append(f"updated_by=${idx}")
    vals.append(user["user_id"])
    await pool.execute(
        f"UPDATE public.graha_clients SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=${idx + 1}::uuid",
        str(client_id), *vals, org_id,
    )
    return {"status": "updated"}


@router.delete("/clients/{client_id}")
async def delete_client(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    pool = await get_pool()
    # `execute` returns the command tag, and this route used to throw it away
    # and answer `{"status": "deleted"}` unconditionally — so a client that
    # belonged to another org, or one already deleted, produced a green toast
    # and a list that had not changed. "Delete does nothing" is exactly what a
    # lying success looks like from the outside, and it is unfalsifiable from
    # the UI: there is no difference between a delete that worked and one that
    # matched no rows.
    #
    # `update_client` has the same shape and the same silence; it is left alone
    # here only because this commit is about the delete path.
    # A soft delete is an edit like any other, and the one edit people most
    # want to trace afterwards — "who removed this company?" has no answer
    # anywhere else, because the row is still here and nothing else records the
    # act. `$3` is appended at the END of the existing binds so the `$1`/`$2`
    # the WHERE clause already uses are undisturbed.
    tag = await pool.execute(
        "UPDATE public.graha_clients SET is_active=FALSE, updated_at=NOW(), "
        "updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(client_id), org_id, user["user_id"],
    )
    if tag.split()[-1] == "0":
        raise HTTPException(404, "Client not found")
    return {"status": "deleted"}


# ── Contacts ─────────────────────────────────────────────────

@router.get("/contacts")
async def list_contacts(
    contact_type: Optional[str] = None,
    search: Optional[str] = None,
    label_id: Optional[str] = None,
    since: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    """Contacts — or, with `?since=`, only those changed since that moment.

    The delta drops `is_active=TRUE`, because a deactivated contact is how the
    deletion reaches the device. See `services/delta_sync`.
    """
    from services.delta_sync import envelope, parse_since

    since_dt = parse_since(since)
    synced_at = datetime.now(timezone.utc)
    pool = await get_pool()
    query = (
        # `gstin` travels with the list because the invoice form derives place of
        # supply and the CGST/SGST-versus-IGST split from the customer's state
        # code (s.12(2)(a) IGST Act), and it only ever holds the LIST — the
        # detail route is a second request it does not make. Without it the
        # derivation had nothing to read and the tax treatment of every invoice
        # rested on a free text box and an unticked checkbox.
        #
        # It is not a disclosure: a GSTIN is a public registration, this route is
        # behind the same `_gate` as the detail route that already prints it, and
        # the two return the same rows.
        "SELECT c.id, c.name, c.email, c.phone, c.company, c.designation, c.contact_type, "
        "c.gstin, c.tags, c.source, c.lead_score, c.assigned_to, c.last_contacted_at, "
        "c.created_at, c.updated_at, c.client_id, c.custom_data, cl2.name AS client_name, "
        # The author and the last editor as NAMES. This SELECT is explicit
        # column by column, so `created_by`/`updated_by` themselves stay off
        # the wire entirely — the ids are only ever join keys here, which is
        # the shape every list should have had.
        + actor_select("c", updated=True) +
        "COUNT(*) OVER() AS _total "
        "FROM public.graha_contacts c "
        # `AND cl2.org_id = c.org_id`: a join on the id alone would print
        # another organisation's company name against this org's contact if a
        # `client_id` ever crossed the boundary. The write paths now refuse
        # that, but the read must not depend on the write having been correct.
        "LEFT JOIN public.graha_clients cl2 ON cl2.id = c.client_id AND cl2.org_id = c.org_id "
    )

    if label_id:
        query += "JOIN public.graha_contact_labels cl ON cl.contact_id = c.id "

    # LAST of the joins, so it cannot come between the optional label JOIN and
    # the FROM it attaches to. Both actor joins are LEFT: an inner join would
    # make every contact created by a since-deleted colleague VANISH from the
    # list, and a filter that silently removes rows looks exactly like one that
    # is working.
    query += actor_joins("c", updated=True)

    query += ("WHERE c.org_id=$1::uuid "
              + ("" if since_dt is not None else "AND c.is_active=TRUE "))
    params: list = [org_id]
    idx = 2

    if label_id:
        query += f"AND cl.label_id=${idx}::uuid "
        params.append(label_id)
        idx += 1

    if contact_type:
        query += f"AND c.contact_type=${idx} "
        params.append(contact_type)
        idx += 1

    if search:
        query += f"AND (c.name ILIKE '%' || ${idx} || '%' OR c.email ILIKE '%' || ${idx} || '%' OR c.company ILIKE '%' || ${idx} || '%') "
        params.append(search)
        idx += 1

    if since_dt is not None:
        params.append(since_dt)
        # ASCENDING for a delta: a truncated window is resumed from the LAST
        # row's stamp, and that only works if the oldest change arrives first.
        query += f"AND c.updated_at > ${len(params)} ORDER BY c.updated_at ASC LIMIT 200"
    else:
        query += "ORDER BY c.created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    if since_dt is not None:
        return envelope([dict(r) for r in rows], since_dt, synced_at, limit=200)
    return _listed(rows, limit=200)


async def resolve_contact_company(pool, org_id: str, client_id: str,
                                  strict: bool = True) -> str:
    """Which company does this person work for? — `graha_contacts.client_id`.

    A CRM client is the COMPANY. Contacts are the people who come and go; the
    customer stays, and `client_id` is the only column that says which company
    a person belongs to.

    ── WHY IT IS NOW LOAD-BEARING ──────────────────────────────────────────
    `services/prachar_compliance` gates every marketing send on it: the
    audience resolver adds `AND client_id IS NOT NULL` unless a filter
    explicitly says otherwise, because a CA firm soliciting a NON-client is
    professional misconduct under the ICAI code. A contact written with a NULL
    `client_id` is therefore permanently unemailable — not a cosmetic gap, a
    person the firm can never lawfully contact through this product.

    ── VALIDATED, NOT TRUSTED ──────────────────────────────────────────────
    A `client_id` arriving in a request body is user input, and the foreign key
    on this column is not composite with `org_id` — the database alone would
    accept one organisation attaching its contact to another's company row.
    The same reasoning, and the same shape, as `vikray.resolve_order_company`.

    ── `strict=False`, AND WHY THE PUBLIC PATHS USE IT ─────────────────────
    A person filling in a form is not the person who configured it. On the two
    UNAUTHENTICATED paths — the web form and the inbound-lead webhook — the
    company comes from org configuration that may have gone stale since: the
    client was archived, or merged away, months after the form went live.
    Refusing there would turn a stale setting into a 400 on every submission,
    and on those routes a refused request is a LOST CUSTOMER, silently. So an
    unresolvable company degrades to "no company" instead: the lead is kept,
    and the ICAI gate holds it back from marketing until somebody links it.

    On the authenticated CRM routes it stays strict — there a bad `client_id`
    is a caller getting it wrong, and the caller is present to be told.

    Returns "" for "no company named", never None: every caller binds the
    result through `NULLIF($n,'')::uuid`, and an untyped NULL through PgBouncer
    is the parse error that reads as an instant 500.
    """
    if not client_id:
        return ""
    ok = await pool.fetchval(
        "SELECT 1 FROM public.graha_clients "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        client_id, org_id)
    if not ok:
        if not strict:
            log.warning("client_id %s is not a live company in org %s — the "
                        "contact is being written with no company",
                        client_id, org_id)
            return ""
        raise HTTPException(400, "That company is not in this organisation")
    return client_id


async def resolve_contact_territory(pool, org_id: str, territory_id: str) -> str:
    """Which sales patch does this person fall in? — `graha_contacts.territory_id`.

    ── VALIDATED FOR THE SAME REASON `client_id` IS ────────────────────────
    Migration 023 wrote the foreign key as a plain
    `REFERENCES staging.graha_territories(id)` with NO `org_id` in it, exactly
    like `graha_contacts.client_id`. The database alone would therefore accept
    one organisation filing its contact under ANOTHER organisation's territory,
    and the territory carries `assigned_users` — so the leak does not stop at a
    label. `POST /territories/{id}/assign-next` reads that array to hand a lead
    to a rep, which means a mis-scoped territory hands one firm's customer to a
    different firm's salesperson.

    `memory/graha_clients_join_leak` records the same shape on the company
    column and counted nine joins owed. This is the tenth, closed at the point
    the column became writable rather than after — Phase 7.1a's rule is that the
    leak closes in the SAME commit that makes it reachable, because until today
    NOTHING could put a value in this column and the hole was theoretical.

    `is_active=TRUE` matters as much as `org_id`: `DELETE /territories/{id}` is
    a soft delete that only flips the flag, so a deleted territory keeps its row
    and would otherwise stay assignable for ever.

    Returns "" for "no territory named", never None — every caller binds through
    `NULLIF($n,'')::uuid`, and an untyped NULL through PgBouncer is the parse
    error that reads as an instant 500.
    """
    if not territory_id:
        return ""
    ok = await pool.fetchval(
        "SELECT 1 FROM public.graha_territories "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        territory_id, org_id)
    if not ok:
        raise HTTPException(400, "That territory is not in this organisation")
    return territory_id


async def resolve_deal_owner(pool, org_id: str, user_id: str) -> str:
    """The person a deal is assigned to, PROVEN to be a member of this org.

    ── WHY THIS EXISTS NOW AND NOT BEFORE ──────────────────────────────────

    `graha_deals.assigned_to` is a bare `text` column holding a
    `users.user_id`. It carries NO foreign key at all — not a non-composite
    one like the four ids `create_deal` already resolves, none — so the
    database has never had an opinion about who a deal may be assigned to, and
    neither did this router: `body.assigned_to` went straight into the INSERT
    and `update_deal`'s SET-build.

    It stayed harmless for one reason only: NO SCREEN IN THE PRODUCT COULD
    WRITE THE COLUMN. A sweep of `frontend/src` and `mobile/` on 2026-08-29
    found three readers and no writer, and 0 of 30 live deals on the reference
    org carried a value. The hole was latent because the door was shut.

    That door is now open — Graha's deal form and the deal record both offer an
    owner — so the guard lands in the SAME change that makes the column
    reachable. Phase 7.1a's rule, and the one `resolve_contact_territory`
    records four functions up: the leak closes in the commit that arms it, not
    in the one after.

    What an unchecked value would buy an attacker is real rather than
    theoretical. `graha_deals.assigned_to` is what Vikray's sales-target
    attainment joins on (`routers/vikray.py` `_ATTAINMENT_SQL`), what the
    rep-performance report groups by, and what `GET /graha/today` filters a
    person's own work list on — so one organisation could post its revenue
    into another organisation's leaderboard, and name a stranger as the owner
    of a deal they can see on their own screens.

    Membership is `staging.user_roles`, which is the sole tenant path
    (`memory/architecture_tenancy`) and the same table `GET /v1/org/members`
    lists the picker's options from — so anything the form can offer, this
    accepts, and nothing else.

    Returns "" for "nobody named", never None: `""` is the deliberate clear
    value and both call sites bind it through `NULLIF($n,'')`. Both parameters
    are text against text columns, so there is no untyped-`$n`-into-`uuid`
    hazard here — the fault this repo signs its name to — and no cast is added
    that would invite one.
    """
    if not user_id:
        return ""
    ok = await pool.fetchval(
        "SELECT 1 FROM public.user_roles WHERE user_id=$1 AND org_id=$2::uuid",
        user_id, org_id)
    if not ok:
        raise HTTPException(400, "That person is not a member of this organisation")
    return user_id


async def resolve_deal_contact(pool, org_id: str, contact_id: str) -> str:
    """Which PERSON is this deal with? — `graha_deals.contact_id`.

    ── THE THIRD COLUMN WITH THE SAME HOLE ─────────────────────────────────
    Phase 7.1a closed `graha_deals.territory_id` and recorded the shape:
    a foreign key written as a bare `REFERENCES staging.graha_contacts(id)`
    with no `org_id` in it, so the DATABASE ALONE cannot tell a caller in one
    organisation from a caller in another. Read live on 27 Aug, every foreign
    key on `graha_deals` is that shape — `client_id`, `contact_id`,
    `pipeline_id` and `territory_id`, four constraints, not one of them
    composite with `org_id`. Territory was the only one that got a guard.

    So an attacker holding a valid session in org A, guessing a contact uuid
    out of org B, could until now POST a deal that carries it and Postgres
    would accept the row without a murmur. THAT IS NOT A DANGLING LABEL:

      · `deal_detail` returns `c.name` and `c.email` off this join, so the
        stolen id is READ BACK as a name and an email address — a
        cross-tenant disclosure of exactly the field `decision_platform_privacy`
        says must not cross an org boundary.
      · `create_deal` fires `compute_lead_score(pool, org_id, contact_id)` on
        the way out, which WRITES `lead_score` and `lead_score_reasons` onto a
        row belonging to somebody else's customer. A read leak is bad; a
        cross-tenant WRITE dressed as a score is worse, and it happens with no
        further request.
      · `graha_activities` and the follow-up paths hang off the same person.

    `is_active=TRUE` is not decoration either. `DELETE /contacts/{id}` is a
    SOFT delete — line ~1067 flips the flag and keeps the row — so without it a
    contact a firm deliberately removed stays attachable to new deals for ever,
    and reappears on the deal list under the name they asked to have taken off.
    `add_contact_label` already validates a contact with exactly this triple
    (`id`, `org_id`, `is_active`); this is that check, named, so the deal paths
    stop being the ones that skip it.

    Returns "" for "no person named", never None: every caller binds through
    `NULLIF($n,'')::uuid`, and an untyped NULL through PgBouncer is the parse
    error that reads as an instant 500.
    """
    if not contact_id:
        return ""
    ok = await pool.fetchval(
        "SELECT 1 FROM public.graha_contacts "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        contact_id, org_id)
    if not ok:
        raise HTTPException(400, "That contact is not in this organisation")
    return contact_id


async def resolve_deal_pipeline(pool, org_id: str, pipeline_id: str) -> str:
    """Which board does this deal sit on? — `graha_deals.pipeline_id`.

    ── THE ONE THAT LEAKS SIDEWAYS RATHER THAN OUTWARD ─────────────────────
    Same non-composite foreign key as the other three, and it was the one that
    reached SQL most directly of all: `create_deal` read `body.pipeline_id`,
    found it truthy, and bound it. No SELECT of any kind ran against it.

    The consequence is not a name on a card, it is a deal that has left its own
    organisation's workflow. `deals_kanban` resolves the org's DEFAULT pipeline
    and lists only deals whose `pipeline_id` matches it, so a deal filed on
    another tenant's board is INVISIBLE on every board in its own org while
    still counting in `list_deals` totals and in the CRM report. That is the
    worst kind of tenancy bug: it does not error, it does not show, and the
    numbers stop agreeing with the screens.

    It also decides what the stage names MEAN. `graha_pipelines.stages` is a
    per-org array, and `update_deal` writes whatever `stage` string it is
    given; a deal pinned to a foreign pipeline is being validated, reported and
    drawn against a vocabulary its own organisation never defined.

    `is_active=TRUE` for the same reason as everywhere else in this file: the
    pipeline list is filtered on it, so an inactive pipeline is one no caller
    can legitimately have chosen from a picker.

    Returns "" for "not named", never None — `create_deal` reads that "" as
    "fall through to the default pipeline", which is the pre-existing behaviour
    for an absent `pipeline_id` and is deliberately unchanged.
    """
    if not pipeline_id:
        return ""
    ok = await pool.fetchval(
        "SELECT 1 FROM public.graha_pipelines "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        pipeline_id, org_id)
    if not ok:
        raise HTTPException(400, "That pipeline is not in this organisation")
    return pipeline_id


async def resolve_deal_id(pool, org_id: str, deal_id: str) -> str:
    """Which deal is this activity / follow-up / document filed against?

    ── FOUND BY SWEEPING FOR THE SHAPE RATHER THAN THE SYMPTOM ─────────────
    `graha_deals` was the table named in the finding, but the same
    non-composite foreign key runs the other way too: `graha_activities`,
    `graha_follow_ups` and `graha_documents` each reference `graha_deals(id)`
    and `graha_contacts(id)` with `org_id` in NEITHER constraint — six more
    unscoped keys, read live off `pg_constraint` on 27 Aug — and all four write
    paths bound the request body straight into the INSERT.

    The direction of the damage is the interesting part, because it inverts.
    On a deal, a foreign id READS another tenant's data back to the attacker.
    Here it WRITES: the attacker's note, their reminder, their uploaded file is
    filed against a deal in an organisation they have no membership of, and
    then it is shown to that organisation. `deal_detail` lists the activities
    on a deal; `/follow-ups` joins them for the reminder cron, which EMAILS the
    assignee. So the unguarded id is an injection into another firm's record
    and, through the follow-up path, into another firm's mailbox.

    The `org_id` column on the child row does not save this. It is set from the
    caller's own session, so the child is correctly stamped org A while
    pointing at a parent in org B — the row looks perfectly well-formed from
    the child's side and only the join reveals it. That is exactly why a live
    count of cross-org PAIRS, not a count of malformed rows, is the control.

    `is_active=TRUE` because `DELETE /deals/{id}` is a soft delete (it flips
    the flag and keeps the row), so a deleted deal must not keep accepting new
    attachments.

    Returns "" for "no deal named", never None — every caller binds through
    `NULLIF($n,'')::uuid`.
    """
    if not deal_id:
        return ""
    ok = await pool.fetchval(
        "SELECT 1 FROM public.graha_deals "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        deal_id, org_id)
    if not ok:
        raise HTTPException(400, "That deal is not in this organisation")
    return deal_id


@router.post("/contacts")
async def create_contact(
    body: ContactCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    pool = await get_pool()
    valid_types = ("lead", "customer", "vendor", "partner")
    if body.contact_type not in valid_types:
        raise HTTPException(400, f"contact_type must be one of: {', '.join(valid_types)}")

    # The write and its event share ONE transaction, the same contract the task
    # emitters keep: the event exists if and only if the contact does. An
    # autocommitted INSERT followed by a separate emit leaves a window where the
    # row is committed and no rule ever hears about it.
    #
    # `RETURNING *` rather than the three columns the response needs, because
    # `contact_created` reads seven of them for the event payload. The RESPONSE
    # is built explicitly below so its shape is unchanged by that.

    # The employer, checked against THIS org before it is written. See
    # `resolve_contact_company`: without the check the foreign key alone would
    # let one organisation file its contact under another's company.
    client_id = await resolve_contact_company(pool, org_id, body.client_id)
    # And the sales patch, checked the same way and for the same reason.
    territory_id = await resolve_contact_territory(pool, org_id, body.territory_id)

    from services.niyam.subjects import contact_created
    try:
        async with pool.acquire() as _conn:
            async with _conn.transaction():
                row = await _conn.fetchrow(
                    "INSERT INTO public.graha_contacts "
                    "(org_id, name, email, phone, company, designation, gstin, pan, "
                    " billing_address, shipping_address, tags, notes, contact_type, source, created_by, client_id, "
                    " custom_data, territory_id) "
                    "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULLIF($16,'')::uuid, "
                    " $17::jsonb, NULLIF($18,'')::uuid) "
                    "RETURNING *",
                    org_id, body.name, body.email, body.phone, body.company, body.designation,
                    body.gstin, body.pan, json.dumps(body.billing_address), json.dumps(body.shipping_address),
                    body.tags, body.notes, body.contact_type, body.source, user["user_id"], client_id,
                    json.dumps(body.custom_data or {}), territory_id,
                )
                # ── PIN -> TERRITORY -> REP, Phase 7.1 ────────────────────
                #
                # HERE, and the position is the whole design. After the INSERT,
                # because routing reads the address that was just written and
                # the client it was just attached to. Before `contact_created`,
                # so the event the automation engine sees carries the territory
                # rather than announcing a contact that acquires one a moment
                # later — a rule on "a contact is created in Gujarat" has to be
                # able to read Gujarat off the event.
                #
                # NOT `_bg()`. `create_deal` below fires `compute_lead_score`
                # that way and `server.py:187-191` records the cost: a Railway
                # restart drops every pending background task, silently. A
                # stale lead score is a wrong number; an unrouted contact is a
                # lead nobody is working and nothing anywhere says so.
                #
                # It cannot fail this handler — `route_contact` runs its own
                # SAVEPOINT and swallows its own bugs, for the standing reason
                # that this blocks nothing. If it routed, it returns the row it
                # rewrote, and that is the row the event should carry.
                routed = await territory_routing.route_contact(_conn, org_id, str(row["id"]))
                if routed["row"] is not None:
                    row = routed["row"]
                await contact_created(_conn, org_id=org_id, actor_id=user["user_id"],
                                      contact_id=row["id"], row=dict(row))
    except Exception as e:
        log.error("create_contact failed: %s", e, exc_info=True)
        raise
    # `territory_name`, not `territory_id`: the screen that draws this needs to
    # say "filed under Gujarat", and a uuid identifies nobody. Additive — every
    # existing caller reads id/name/contact_type and is untouched. Empty string
    # when nothing routed, which is the ordinary case and not an error.
    return {"status": "created", "id": row["id"], "name": row["name"],
            "contact_type": row["contact_type"],
            "territory_name": routed["territory_name"]}


# ── Dedupe & Merge ───────────────────────────────────────────
# NOTE: these literal paths MUST stay above /contacts/{contact_id}. FastAPI
# matches in declaration order, and contact_id is typed UUID — "duplicates"
# would fail validation with a 422 rather than falling through to here.

@router.get("/contacts/duplicates")
async def list_duplicate_groups(
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    Review queue: groups of live contacts sharing a normalized email or phone.
    Exact keys only — fuzzy name matches are surfaced per-contact via
    /contacts/{id}/duplicates, since they are too weak to queue org-wide.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """
        WITH live AS (
            SELECT * FROM public.graha_contacts
            WHERE org_id=$1::uuid AND is_active=TRUE AND merged_into_id IS NULL
        ),
        groups AS (
            SELECT 'email' AS match_type, email_norm AS match_key,
                   array_agg(id) AS ids, count(*) AS n
            FROM live WHERE email_norm IS NOT NULL
            GROUP BY email_norm HAVING count(*) > 1
            UNION ALL
            SELECT 'phone', phone_norm, array_agg(id), count(*)
            FROM live WHERE phone_norm IS NOT NULL
            GROUP BY phone_norm HAVING count(*) > 1
        )
        SELECT g.match_type, g.match_key, g.n,
               (SELECT json_agg(json_build_object(
                    'id', c.id, 'name', c.name, 'email', c.email,
                    'phone', c.phone, 'company', c.company,
                    'contact_type', c.contact_type, 'lead_score', c.lead_score,
                    'source', c.source, 'created_at', c.created_at
                ) ORDER BY c.created_at)
                FROM public.graha_contacts c WHERE c.id = ANY(g.ids)
               ) AS contacts
        FROM groups g
        ORDER BY g.n DESC, g.match_type
        LIMIT $2
        """,
        org_id, limit,
    )
    return {
        "data": [
            {
                "match_type": r["match_type"],
                "match_key": r["match_key"],
                "count": r["n"],
                "contacts": json.loads(r["contacts"]) if isinstance(r["contacts"], str) else r["contacts"],
            }
            for r in rows
        ]
    }


@router.get("/contacts/merges")
async def list_merges(
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Recent merges, for the undo window."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT m.id, m.survivor_id, m.merged_id, m.moved_rows, m.field_updates, "
        "       m.actor_id, m.created_at, m.undone_at, "
        "       s.name AS survivor_name, l.name AS merged_name "
        "FROM public.graha_contact_merges m "
        "JOIN public.graha_contacts s ON s.id = m.survivor_id "
        "JOIN public.graha_contacts l ON l.id = m.merged_id "
        "WHERE m.org_id=$1::uuid "
        "ORDER BY m.created_at DESC LIMIT $2",
        org_id, limit,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/contacts/merges/{merge_id}/undo")
async def undo_contact_merge(
    merge_id: UUID,
    # Was `require_org_role("org_admin")`, which omitted org_owner — the org's
    # MOST privileged role could not undo a merge its own admin could perform.
    # A hardcoded role string is exactly the failure role_tiers.py exists to end.
    user=Depends(require_org_role(*ORG_MANAGEMENT_ROLES)),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Reverse a merge and restore the merged contact."""
    pool = await get_pool()
    try:
        return await undo_merge(pool, org_id, str(merge_id), user["user_id"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/contacts/{contact_id}/duplicates")
async def contact_duplicates(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Candidate duplicates for one contact — exact and fuzzy."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT name, email, phone, company FROM public.graha_contacts "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(contact_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Contact not found")

    matches = await find_duplicates(
        pool, org_id,
        email=row["email"], phone=row["phone"],
        name=row["name"], company=row["company"],
        exclude_id=str(contact_id),
    )
    return {"data": matches}


@router.post("/contacts/{contact_id}/merge")
async def merge_into_contact(
    contact_id: UUID,
    body: ContactMerge,
    # See the note on undo_contact_merge: org_owner was locked out of a
    # destructive action that org_admin could take.
    user=Depends(require_org_role(*ORG_MANAGEMENT_ROLES)),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    Merge other contacts into this one (the survivor).
    Destructive enough to be admin-only, but reversible via
    /contacts/merges/{merge_id}/undo.
    """
    if not body.merge_ids:
        raise HTTPException(400, "merge_ids must not be empty")
    if len(body.merge_ids) > 20:
        raise HTTPException(400, "Cannot merge more than 20 contacts at once")

    pool = await get_pool()
    try:
        result = await merge_contacts(
            pool, org_id, str(contact_id),
            [str(m) for m in body.merge_ids],
            user["user_id"],
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"status": "merged", **result}


@router.get("/contacts/{contact_id}")
async def get_contact(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        # `client_name` comes back on the LIST route and had to come back here
        # too: the contact's employer is now the client dropdown alone — the
        # free-text `company` box is gone from both forms — so the detail
        # screen has nothing to print without the join.
        # `assigned_to_name` for the same reason as rep-performance above: the
        # detail panel drew `assigned_to.substring(0, 8)`. `territory_name` so
        # the panel can show which patch the contact routes to without the
        # screen holding a second lookup — 7.0 made that column writable.
        "SELECT c.*, cl.name AS client_name, "
        f"       {_USER_NAME_SQL} AS assigned_to_name, "
        "       tr.name AS territory_name "
        "FROM public.graha_contacts c "
        # Org-scoped join — see the note on the list route.
        "LEFT JOIN public.graha_clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id "
        # And the territory join is org-scoped for the SAME reason the client
        # one is: `graha_territories.id` is unique table-wide, so joining on the
        # id alone would surface another organisation's territory name against
        # this contact. `memory/graha_clients_join_leak` counted nine of these
        # owed; this is one of them, closed at the point it was written rather
        # than after.
        "LEFT JOIN public.graha_territories tr ON tr.id = c.territory_id AND tr.org_id = c.org_id "
        "LEFT JOIN users u ON u.user_id = c.assigned_to "
        "WHERE c.id=$1::uuid AND c.org_id=$2::uuid AND c.is_active=TRUE",
        str(contact_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Contact not found")

    deals = await pool.fetch(
        "SELECT id, title, value, stage, created_at FROM public.graha_deals "
        "WHERE contact_id=$1::uuid AND is_active=TRUE ORDER BY created_at DESC",
        str(contact_id),
    )
    activities = await pool.fetch(
        "SELECT id, activity_type, title, scheduled_at, is_completed, created_at "
        "FROM public.graha_activities WHERE contact_id=$1::uuid ORDER BY created_at DESC LIMIT 20",
        str(contact_id),
    )
    follow_ups = await pool.fetch(
        "SELECT id, title, description, due_at, remind_at, is_completed, completed_at, "
        "assigned_to, deal_id, created_at "
        "FROM public.graha_follow_ups WHERE contact_id=$1::uuid ORDER BY due_at ASC",
        str(contact_id),
    )
    labels = await pool.fetch(
        "SELECT l.id, l.name, l.color FROM public.graha_labels l "
        "JOIN public.graha_contact_labels cl ON cl.label_id = l.id "
        "WHERE cl.contact_id=$1::uuid ORDER BY l.name",
        str(contact_id),
    )
    return {
        # `_with_digipin`, not `dict(row)`: a contact carries a coordinate too
        # (migration 237 adds the four columns to BOTH tables), and a detail
        # screen that showed the pair without the code would send a reader
        # looking for a DIGIPIN feature that is already here.
        "contact": _with_digipin(row),
        "deals": [dict(d) for d in deals],
        "activities": [dict(a) for a in activities],
        "follow_ups": [dict(f) for f in follow_ups],
        "labels": [dict(lb) for lb in labels],
    }


@router.patch("/contacts/{contact_id}")
async def update_contact(
    contact_id: UUID,
    body: ContactUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    pool = await get_pool()
    # `exclude_unset` is what stops this PATCH nulling the columns it was not
    # asked about — `client_id` above all. A field the request never mentioned
    # is not in `updates`, so it never reaches the SET list and the company a
    # contact belongs to survives an edit of their phone number.
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    if "lead_score" in updates:
        score = updates["lead_score"]
        if score < 0 or score > 100:
            raise HTTPException(400, "lead_score must be 0–100")

    # Named explicitly, so it is checked explicitly — the same org check the
    # create path makes. `""` is the deliberate "no employer" value and clears
    # the link through the NULLIF below; anything else must be a live company
    # in THIS org before it is written.
    if "client_id" in updates:
        updates["client_id"] = await resolve_contact_company(
            pool, org_id, updates["client_id"])

    # Same check, same reason, same "" clears it. Named explicitly rather than
    # falling through the generic branch below, because the generic branch binds
    # a bare `$n` — and a bare text parameter into a `uuid` column is the
    # untyped-parse 500 PgBouncer turns every ambiguous expression into.
    if "territory_id" in updates:
        updates["territory_id"] = await resolve_contact_territory(
            pool, org_id, updates["territory_id"])

    sets = []
    params = [str(contact_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k in ("lead_score_reasons", "billing_address", "shipping_address", "custom_data"):
            sets.append(f"{k}=${idx}::jsonb")
            params.append(json.dumps(v))
        elif k == "assigned_to":
            sets.append(f"{k}=NULLIF(${idx},'')")
            params.append(v)
        elif k in ("client_id", "territory_id"):
            sets.append(f"{k}=NULLIF(${idx},'')::uuid")
            params.append(v)
        else:
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")
    # The actor goes in the SAME statement as the stamp. `idx` is whatever the
    # loop above left free, and `params` is appended in lockstep with it, so
    # this cannot disturb the `$1`/`$2` the WHERE clause holds.
    sets.append(f"updated_by=${idx}")
    params.append(user["user_id"])
    idx += 1

    await pool.execute(
        f"UPDATE public.graha_contacts SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


@router.delete("/contacts/{contact_id}")
async def delete_contact(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    pool = await get_pool()
    await pool.execute(
        # Same reasoning as `delete_client`: the row survives the delete, so
        # `updated_by` is the only record that this person removed it.
        "UPDATE public.graha_contacts SET is_active=FALSE, updated_at=NOW(), "
        "updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(contact_id), org_id, user["user_id"],
    )
    return {"status": "deleted"}


# ── The coordinate, written on purpose ───────────────────────
#
# Phase 8.4, and migration 237 is the other half of it. Read that file's header
# before changing anything below: the rules this code enforces are the SAME
# rules the CHECK constraints enforce, and the two must not drift.
#
# ── WHY A SEPARATE ROUTE AND NOT A FIELD ON `ClientUpdate` ───────────────────
#
# It would have been three lines to add `lat`/`lng` to the two PATCH models and
# let the generic SET-build carry them. That is the wrong shape, for reasons
# that are all the same reason:
#
#   * `geo_fetched_at` MUST be server-side. On a PATCH model it would be a
#     field, and a field is something a caller can send — which would let the
#     30-day Google retention clock be reset by the thing it constrains. There
#     is no `geo_fetched_at` on `CoordinateWrite` at all, so there is no code
#     path that can accept one. `tests/test_client_coordinates.py` asserts the
#     absence, because "we just don't set it" is a convention and an absent
#     field is a fact.
#   * The four columns MOVE TOGETHER. `update_contact` builds its SET list from
#     whatever keys the request happened to send; a request naming `lat` and
#     not `geo_source` would build a statement that writes a bare pair, and the
#     only thing standing between that and a stored coordinate with no
#     provenance would be a 23514 the user reads as "Internal Server Error".
#   * CLEARING is a different verb. `update_contact` drops `None` values on the
#     floor — `{k: v for ... if v is not None}` — so `{"lat": null}` there is
#     not "clear it", it is "do nothing". A DELETE says what it means.
#
# ── WHAT THIS ROUTE IS NOT ──────────────────────────────────────────────────
#
# It is not a geocoder and it never calls one. It takes a coordinate the
# CALLER already holds — from a pin the user dragged, from the device's own
# Geolocation API, or typed — and stores it with a label saying which. A
# server-side geocode here would be a metered vendor call on a write path and
# would send a client's premises to Mappls, which is precisely what §8.4 exists
# to avoid.

#: The five lawful provenances, mirrored EXACTLY from `237_*.sql`'s
#: `*_geo_source_ck`. There is deliberately no Mappls value — Mappls forbids
#: caching a geocode result, so a Mappls coordinate has no lawful home in this
#: database, and the database will refuse one even if this tuple is widened by
#: mistake. `tests/test_client_coordinates.py` reads the migration file and
#: fails if these two lists ever disagree.
GEO_SOURCES = ("user_pin", "device_gps", "manual_entry", "google_places", "import")

#: The ONLY two tables this route may write, by name, as literals. The table
#: name is interpolated into SQL below, so it can never come from a request
#: value: it is looked up here or the request is refused. This is the
#: server-side allowlist the SQL convention requires for any dynamic
#: identifier.
_COORD_TABLES = {
    "clients": "public.graha_clients",
    "contacts": "public.graha_contacts",
}


def _coordinate_sql(table: str) -> str:
    """Set all four, plus the audit pair, in ONE statement.

    `geo_fetched_at=NOW()` is written here and nowhere else — it takes no
    parameter, so there is no bind position a caller could ever reach.

    `updated_by` rides in the same statement as `updated_at` for the reason
    `update_client` gives: two statements would let the stamp and the actor
    disagree, and a confident wrong answer is worse than none.

    `RETURNING` rather than a command tag, so a row that matched no org is a
    `None` and becomes a 404 instead of the lying `{"status": "updated"}`
    `delete_client`'s comment describes.
    """
    return (
        f"UPDATE {table} SET lat=$3::numeric, lng=$4::numeric, geo_source=$5, "
        "geo_fetched_at=NOW(), updated_at=NOW(), updated_by=$6 "
        "WHERE id=$1::uuid AND org_id=$2::uuid "
        "RETURNING lat, lng, geo_source, geo_fetched_at"
    )


def _coordinate_clear_sql(table: str) -> str:
    """All four to NULL, together, or not at all.

    Nulling the pair and leaving `geo_source` behind would raise 23514 against
    `*_geo_complete_ck` — the constraint is what makes this statement's shape
    non-negotiable rather than a habit. Written out in full here so a reader
    can see all four names in one place.
    """
    return (
        f"UPDATE {table} SET lat=NULL, lng=NULL, geo_source=NULL, "
        "geo_fetched_at=NULL, updated_at=NOW(), updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid "
        "RETURNING id"
    )


#: Every statement this route can issue, keyed by table, so the live-schema
#: test can PREPARE all four against the real catalogue without importing the
#: handlers. `tests/test_pincode_lookup.py` does the same with
#: `pin_directory.LOOKUP_SQL`, and for the same reason: a statement is not
#: trusted until the server has planned it.
COORDINATE_SQL = {
    table: {"set": _coordinate_sql(table), "clear": _coordinate_clear_sql(table)}
    for table in _COORD_TABLES.values()
}


class CoordinateWrite(BaseModel):
    """One coordinate and where it came from. NOTHING ELSE.

    ⚠ THERE IS NO `geo_fetched_at` FIELD AND THERE MUST NEVER BE ONE. It is
      stamped `NOW()` by the database. See the block comment above.
    """
    lat: float
    lng: float
    geo_source: str


def _checked_coordinate(body: CoordinateWrite) -> tuple[Decimal, Decimal, str]:
    """Refuse before the database has to, and say why in words a person reads.

    Every refusal here is also refused by a CHECK in migration 237 — this is
    the layer that turns a 23514 into a 400 with a sentence. The one exception
    is `(0, 0)`, and it is deliberate: see below.
    """
    if body.geo_source not in GEO_SOURCES:
        # Named values in the message, because the caller cannot guess them and
        # because a Mappls value arriving here is a licence problem somebody
        # needs to read about rather than a silent 400.
        raise HTTPException(
            400, "geo_source must be one of: " + ", ".join(GEO_SOURCES))

    for name, value in (("lat", body.lat), ("lng", body.lng)):
        # `json.loads` accepts the literals `NaN` and `Infinity`, so pydantic
        # will hand us a float that is neither of those things a coordinate can
        # be — and `NaN >= -90` is FALSE, so the range test below would refuse
        # it with a message about a range rather than about a number. Checked
        # first so the message is true.
        if not math.isfinite(value):
            raise HTTPException(400, f"{name} must be a finite number")

    if not -90 <= body.lat <= 90:
        raise HTTPException(400, "lat must be between -90 and 90")
    if not -180 <= body.lng <= 180:
        raise HTTPException(400, "lng must be between -180 and 180")

    # NULL ISLAND. (0, 0) is a real point in the Gulf of Guinea and it is the
    # value a failed geocode, an uninitialised form and a dropped decimal all
    # produce. No customer of an Indian PM SaaS is there. The DATABASE allows
    # it — a CHECK is about what is representable — and this route does not,
    # because the alternative is a coordinate stamped `user_pin` that no human
    # ever pointed at, which is the one thing the provenance columns exist to
    # make impossible.
    if body.lat == 0 and body.lng == 0:
        raise HTTPException(
            400, "0, 0 is not a location — it is what a failed lookup returns")

    # `Decimal(str(...))` and not `Decimal(float)`: the latter carries the
    # float's binary error into an exact type and stores 21.170199999999998.
    # Through `str()` the value that arrives is the value that lands, and
    # `numeric(10,7)` rounds the tail. See 237's note on the type.
    return Decimal(str(body.lat)), Decimal(str(body.lng)), body.geo_source


async def _set_coordinate(table: str, record_id: UUID, body: CoordinateWrite,
                          user, org_id: str) -> dict:
    # Belt and braces: the table is already a literal from `_COORD_TABLES` at
    # every call site, and this refuses to interpolate anything else even if a
    # future caller passes a string through. An f-string into SQL is only ever
    # safe because of a line like this one.
    if table not in COORDINATE_SQL:
        raise HTTPException(500, "unknown coordinate table")

    lat, lng, source = _checked_coordinate(body)
    pool = await get_pool()
    row = await pool.fetchrow(
        COORDINATE_SQL[table]["set"],
        str(record_id), org_id, lat, lng, source, user["user_id"],
    )
    if not row:
        # 404 and not 403: a record in another org must be indistinguishable
        # from one that does not exist, or this route becomes a way to ask
        # whether a given id belongs to somebody.
        raise HTTPException(404, "Record not found")
    # `numeric` arrives as `Decimal`. Cast explicitly rather than leaning on
    # the JSON encoder, so the response shape is decided here and does not
    # change if that encoder's Decimal handling ever does.
    return {
        "status": "updated",
        "lat": float(row["lat"]),
        "lng": float(row["lng"]),
        "geo_source": row["geo_source"],
        "geo_fetched_at": row["geo_fetched_at"],
        # ── THE DIGIPIN IS DERIVED HERE AND NOT IN THE BROWSER ───────────────
        #
        # It is pure arithmetic with no vendor and no API call, so a JS copy
        # would work — and that is exactly the trap. Two implementations of a
        # ten-level grid traversal drift at the LAST symbol or two and stay
        # agreeing at level 6, so the divergence appears as two systems naming
        # neighbouring 4 m cells rather than as anything that looks like a bug.
        #
        # `services/digipin.py` is checked symbol-for-symbol against India
        # Post's own reference implementation over 20,000 coordinates. Serving
        # the result keeps that the only implementation in the product.
        #
        # `encode_or_none`, not `encode`: the grid covers lat 2.5-38.5 and lng
        # 63.5-99.5, and a coordinate outside it HAS no DIGIPIN. `null` is that
        # answer. This route already refuses (0, 0) and anything off Earth, so
        # the reachable case is a genuine coordinate outside India's grid — and
        # inventing a code for it would be a confident lie about a ~4 m cell.
        "digipin": digipin.encode_or_none(float(row["lat"]), float(row["lng"])),
    }


async def _clear_coordinate(table: str, record_id: UUID, user,
                            org_id: str) -> dict:
    if table not in COORDINATE_SQL:
        raise HTTPException(500, "unknown coordinate table")
    pool = await get_pool()
    row = await pool.fetchrow(
        COORDINATE_SQL[table]["clear"],
        str(record_id), org_id, user["user_id"],
    )
    if not row:
        raise HTTPException(404, "Record not found")
    return {"status": "cleared"}


@router.put("/clients/{client_id}/coordinate")
async def set_client_coordinate(
    client_id: UUID,
    body: CoordinateWrite,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    """Drop a pin on a company. §8.4."""
    return await _set_coordinate(
        _COORD_TABLES["clients"], client_id, body, user, org_id)


@router.delete("/clients/{client_id}/coordinate")
async def clear_client_coordinate(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    """Remove a company's coordinate AND its provenance, together."""
    return await _clear_coordinate(
        _COORD_TABLES["clients"], client_id, user, org_id)


@router.put("/contacts/{contact_id}/coordinate")
async def set_contact_coordinate(
    contact_id: UUID,
    body: CoordinateWrite,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    """Drop a pin on a person's business address. §8.4's acceptance case."""
    return await _set_coordinate(
        _COORD_TABLES["contacts"], contact_id, body, user, org_id)


@router.delete("/contacts/{contact_id}/coordinate")
async def clear_contact_coordinate(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_crm_entity_gate),
):
    """Remove a contact's coordinate AND its provenance, together.

    This is also the shape a DPDP erasure request takes for this field: one
    statement, all four columns.
    """
    return await _clear_coordinate(
        _COORD_TABLES["contacts"], contact_id, user, org_id)


# ── Pipelines ────────────────────────────────────────────────

@router.get("/pipelines")
async def list_pipelines(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, stages, is_default, created_at "
        "FROM public.graha_pipelines WHERE org_id=$1::uuid AND is_active=TRUE "
        "ORDER BY is_default DESC, created_at",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/pipelines")
async def create_pipeline(
    body: PipelineCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    existing = await pool.fetchval(
        "SELECT COUNT(*) FROM public.graha_pipelines WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    row = await pool.fetchrow(
        "INSERT INTO public.graha_pipelines (org_id, name, stages, is_default) "
        "VALUES ($1::uuid, $2, $3::jsonb, $4) RETURNING id, name",
        org_id, body.name, body.stages, existing == 0,
    )
    return {"status": "created", **dict(row)}


# ── Deals ────────────────────────────────────────────────────

@router.get("/deals")
async def list_deals(
    stage: Optional[str] = None,
    pipeline_id: Optional[str] = None,
    include_archived: bool = False,
    no_follow_up: bool = False,
    since: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Deals — or, with `?since=`, only those changed since that moment.

    A delta MUST see soft-deleted rows: `is_active=FALSE` is how a deletion
    reaches the device, and applying the usual `is_active=TRUE` filter to a
    delta is the single most likely way to ship a sync that looks perfect and
    leaves deleted deals on every phone. Same for archived. The client removes
    any row it receives with `is_active=false` or an `archived_at`.
    """
    from datetime import datetime, timezone

    from services.delta_sync import envelope, parse_since

    since_dt = parse_since(since)
    # Refused rather than ignored, and refused before anything is queried. A
    # delta answers "what changed since T"; `no_follow_up` answers "what is
    # missing a next step" — a set with no relationship to T. Serving the
    # intersection would hand the caller a window that is neither, and serving
    # the delta while dropping the parameter is the disease this module has
    # already been burned by: FollowUpsTab sent `?status=pending` for months,
    # FastAPI discarded it, and a filter that did nothing looked like one that
    # worked.
    if no_follow_up and since_dt is not None:
        raise HTTPException(
            400,
            "A delta cannot be filtered by follow-up state: ?no_follow_up "
            "describes deals that are missing something, which is unrelated to "
            "what changed since ?since. Ask for one or the other.",
        )
    synced_at = datetime.now(timezone.utc)
    pool = await get_pool()
    # Named column by named column, so the SELECT cannot ask for `archived_at`
    # before `migration 133` has been applied.
    from services.deal_archive import archive_ready
    archived_ready = await archive_ready(pool)
    query = (
        "SELECT d.id, d.title, d.value, d.stage, d.probability, d.expected_close_date, "
        "d.assigned_to, d.created_at, d.tags, d.client_id, "
        + ("d.archived_at, " if archived_ready else "") +
        "d.territory_id, tr.name as territory_name, "
        "c.name as contact_name, c.company as contact_company, "
        "cl.name as client_name, "
        # The deal's author and its last editor, resolved to names. A deal is
        # the record people argue about — "who moved this to Won?" — and the
        # answer was only ever in the Niyam event stream, which the deals table
        # cannot join to.
        + actor_select("d", updated=True) +
        # F4 (b): the row count BEFORE the LIMIT, so the caller can say
        # "showing 200 of 510" instead of silently presenting 200 as all of them.
        # Measured on staging: the pipeline screen showed "199 deals have no next
        # step" against a true 510, because the client computed a total from a
        # truncated list.
        #
        # A window function rather than a second COUNT query on purpose. The
        # WHERE clause here is assembled from optional filters, so a separate
        # count would have to rebuild it — and the first time the two drift, the
        # denominator is wrong in a way that looks authoritative. COUNT(*) OVER()
        # cannot disagree with the rows it is counted alongside.
        "COUNT(*) OVER() AS _total "
        "FROM public.graha_deals d "
        "LEFT JOIN public.graha_contacts c ON c.id = d.contact_id "
        # Scoped on `org_id` as well as `id`, the same way `get_deal` below
        # already does it: `graha_clients` has no composite (id, org_id)
        # constraint, so the join is the only thing enforcing tenancy on the
        # company NAME this list renders.
        "LEFT JOIN public.graha_clients cl "
        "       ON cl.id = d.client_id AND cl.org_id = d.org_id "
        # Org-scoped on `org_id` as well as `id`, exactly like the client
        # join above it — and this line was NOT, until Phase 7.1a.
        # `graha_territories.id` is unique table-wide and migration 023
        # wrote a bare `REFERENCES staging.graha_territories(id)` with no
        # org in it, so `ON tr.id = d.territory_id` alone renders whichever
        # organisation owns that uuid. It was harmless only because the
        # column was empty: 0 of 162 live deals carried a territory on
        # 2026-08-27, and 0 cross-org pairs existed. 7.1 is what fills the
        # column, so the leak closes in the commit that arms it.
        "LEFT JOIN public.graha_territories tr "
        "       ON tr.id = d.territory_id AND tr.org_id = d.org_id "
        # Two more LEFT JOINs and no new `$n` — every `${idx}` appended below
        # keeps the number it would have had before this line existed.
        + actor_joins("d", updated=True) +
        "WHERE d.org_id=$1::uuid "
        + ("" if since_dt is not None else "AND d.is_active=TRUE ")
    )
    params: list = [org_id]
    idx = 2

    # A closed deal leaves the board after seven days but never leaves the
    # record — `?include_archived=true` is how the Archived view asks for it.
    # A DELTA is never filtered this way: see the docstring.
    if since_dt is None and not include_archived and archived_ready:
        query += "AND d.archived_at IS NULL "

    if stage:
        query += f"AND d.stage=${idx} "
        params.append(stage)
        idx += 1

    if pipeline_id:
        query += f"AND d.pipeline_id=${idx}::uuid "
        params.append(pipeline_id)
        idx += 1

    # The set the pipeline banner is actually about: deals still in play with
    # nothing scheduled against them. It has to be selected here rather than in
    # the browser, because the browser derived it by subtracting the follow-up
    # list from the deal list and BOTH cap at 200 — for Aekam Inc (512 open
    # deals, one follow-up in the whole org) the banner could only ever say
    # ~200, and said it as a fact. Filtered in the WHERE clause, the
    # `COUNT(*) OVER()` above counts exactly these rows, so `total` is the true
    # uncapped answer.
    #
    # `is_completed = FALSE` rather than "has no follow-up row at all": a deal
    # whose only follow-up is already done has nothing scheduled and belongs in
    # this set. 'Won'/'Lost' is this router's closed-deal vocabulary (the same
    # exclusion the today view uses) — a closed deal needs no next step and
    # would otherwise inflate the count with work nobody owes.
    #
    # The subquery carries no bind parameter, so `idx` is untouched by it.
    if no_follow_up:
        query += (
            "AND d.stage NOT IN ('Won','Lost') "
            "AND NOT EXISTS (SELECT 1 FROM public.graha_follow_ups f "
            "WHERE f.deal_id = d.id AND f.org_id = d.org_id "
            "AND f.is_completed = FALSE) "
        )

    if since_dt is not None:
        params.append(since_dt)
        # Ordered by `updated_at` ASCENDING for a delta, not by creation date
        # descending. If the window is truncated the client resumes from the
        # LAST row's stamp, and it can only do that if the rows arrive oldest
        # change first — sorted the other way, a truncated delta silently drops
        # the middle of the window for ever.
        query += f"AND d.updated_at > ${len(params)} ORDER BY d.updated_at ASC LIMIT 200"
    else:
        query += "ORDER BY d.created_at DESC LIMIT 200"
    rows = await pool.fetch(query, *params)
    if since_dt is not None:
        return envelope([dict(r) for r in rows], since_dt, synced_at, limit=200)
    # `total` is additive — every Graha list already returns {"data": [...]}, so
    # a new sibling key cannot break a caller that reads `.data`. `limit` is
    # reported rather than assumed, so the UI does not have to hardcode 200 to
    # know whether it is looking at a truncated list.
    return _listed(rows, limit=200)


@router.post("/deals")
async def create_deal(
    body: DealCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # ── EVERY ID IN THIS BODY IS PROVEN TO BE THIS ORG'S BEFORE IT IS BOUND ──
    #
    # Four foreign keys reach `graha_deals` from a request body and NOT ONE of
    # the four constraints is composite with `org_id` (read live off
    # `pg_constraint`, 27 Aug). Phase 7.1a guarded `territory_id` and named the
    # other three as unfixed; this is the rest of that job. The rule the file
    # keeps is that presence is not permission — an id that is merely a real
    # uuid somewhere in the database has proved nothing about the caller.
    #
    # THE PIPELINE IS RESOLVED FIRST BECAUSE ITS FALLBACK MUST NOT SWALLOW A
    # REFUSAL. A foreign pipeline id has to 400; it must never quietly become
    # "no pipeline named" and drop through to the org's default, because that
    # turns a cross-tenant attempt into a successful create and tells the
    # caller nothing. `resolve_deal_pipeline` raises on a bad id and returns ""
    # only for an ABSENT one, which is the case the default below is for.
    pipeline_id = await resolve_deal_pipeline(pool, org_id, body.pipeline_id) or None
    if not pipeline_id:
        default = await pool.fetchval(
            "SELECT id FROM public.graha_pipelines "
            "WHERE org_id=$1::uuid AND is_default=TRUE AND is_active=TRUE",
            org_id,
        )
        pipeline_id = str(default) if default else None

    if not pipeline_id:
        p = await pool.fetchrow(
            "INSERT INTO public.graha_pipelines (org_id, name, is_default) "
            "VALUES ($1::uuid, 'Default Pipeline', TRUE) RETURNING id",
            org_id,
        )
        pipeline_id = str(p["id"])

    # THE SALES PATCH, CHECKED AGAINST THIS ORG BEFORE IT IS WRITTEN.
    #
    # `body.territory_id` went straight into the INSERT with no check at all
    # until Phase 7.1a, and migration 023 gave the column a plain
    # `REFERENCES staging.graha_territories(id)` — not composite with `org_id`.
    # So the database alone accepted one organisation filing its deal under
    # ANOTHER organisation's territory, and it is not a labelling mistake: the
    # kanban and the deal list both render that territory's NAME, and the CRM
    # report exports it to a mailed CSV. `resolve_contact_territory` is the
    # same function the contact paths use, checking `org_id` AND `is_active`.
    # `""` stays "" and clears through the `NULLIF` below.
    territory_id = await resolve_contact_territory(pool, org_id, body.territory_id)

    # THE COMPANY, through the same resolver the contact paths use. `strict` is
    # left at its default TRUE and that is the correct half of the split
    # `resolve_contact_company` documents: the lenient half exists for the two
    # UNAUTHENTICATED lead paths, where a refusal is a lost customer and a stale
    # org setting is not the submitter's fault. This route is behind
    # `require_user` and `_gate`, so a bad `client_id` is a caller getting it
    # wrong and the caller is present to be told — degrading to "no company"
    # here would silently drop the link the whole CRM report is built on.
    client_id = await resolve_contact_company(pool, org_id, body.client_id)

    # THE PERSON. Checked before the INSERT rather than after, because
    # `compute_lead_score` below WRITES to this contact row — an unchecked id
    # would not just render another org's contact on the deal, it would rewrite
    # that org's lead score from our request.
    contact_id = await resolve_deal_contact(pool, org_id, body.contact_id)

    # THE OWNER. A `users.user_id` with no foreign key behind it at all, and
    # unchecked here for the whole life of the file — see `resolve_deal_owner`
    # for why that was latent until the deal form grew an owner field, and why
    # the guard lands in the same change that opens the door.
    assigned_to = await resolve_deal_owner(pool, org_id, body.assigned_to)

    # The INSERT and its `deal.created` event share ONE transaction — the same
    # contract every emitter in this router keeps: the event exists if and only
    # if the deal committed. The pipeline bootstrap above stays on the pool on
    # purpose; a default pipeline is real whether or not this deal survives.
    #
    # `RETURNING *` because `deal_created` reads value, client_id, assigned_to
    # and created_by beyond the three columns the response needs; the RESPONSE
    # is built explicitly so its shape is unchanged by the widening.
    # -- A DEAL CAN BE BORN CLOSED, AND THIS PATH NEVER STAMPED IT ---------
    #
    # `update_deal` writes `won_at`/`lost_at` when the stage moves to a closing
    # stage. Creation did not, and `body.stage` is a free string the form and
    # the API both accept -- so a deal ENTERED as Won (a sale already made and
    # logged after the fact, an import, a Playwright seed) was closed on the
    # board and open in every money figure, permanently, because nothing would
    # ever move its stage again to trigger the stamp.
    #
    # Measured live 2026-08-31 on the reference org: 8 such deals, 2,950,000
    # counted as open pipeline while reading Won or Lost on screen. Together
    # with the un-close above this is the whole of suite 12.11's finding -- the
    # three readings of "open pipeline" could not reconcile because two of them
    # trusted the timestamp and the data had none.
    #
    # Same rule as the update path, same two strings, deliberately duplicated
    # rather than shared: the alternative is a helper that the next writer of an
    # INSERT still has to know exists, and a divergence between them would be
    # invisible. They sit 200 lines apart in one file and both name the other.
    _won_at = datetime.now(timezone.utc) if body.stage == "Won" else None
    _lost_at = datetime.now(timezone.utc) if body.stage == "Lost" else None

    from services.niyam.subjects import deal_created
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "INSERT INTO public.graha_deals "
                "(org_id, pipeline_id, contact_id, client_id, title, value, stage, probability, "
                " expected_close_date, assigned_to, notes, tags, created_by, custom_data, territory_id, "
                " won_at, lost_at) "
                "VALUES ($1::uuid, $2::uuid, NULLIF($3,'')::uuid, NULLIF($4,'')::uuid, $5, $6, $7, $8, "
                " NULLIF($9,'')::date, NULLIF($10,''), $11, $12, $13, $14::jsonb, NULLIF($15,'')::uuid, "
                " $16, $17) "
                "RETURNING *",
                org_id, pipeline_id, contact_id, client_id, body.title, body.value,
                body.stage, body.probability, body.expected_close_date,
                assigned_to, body.notes, body.tags, user["user_id"],
                json.dumps(body.custom_data or {}), territory_id,
                _won_at, _lost_at,
            )
            await deal_created(_conn, org_id=org_id, actor_id=user["user_id"],
                               deal_id=row["id"], row=dict(row))
    # The RESOLVED id, not `body.contact_id`. This call WRITES `lead_score` and
    # `lead_score_reasons` onto the contact row, so re-reading the unchecked
    # body value here would put the cross-tenant write straight back after the
    # guard had taken it away. A guard has to hold at every USE of the value,
    # not only at the statement it was written for.
    if contact_id:
        asyncio.ensure_future(compute_lead_score(pool, org_id, contact_id))
    return {"status": "created", "id": row["id"], "title": row["title"],
            "stage": row["stage"]}


@router.get("/deals/kanban")
async def deals_kanban(
    pipeline_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    pid = pipeline_id
    if not pid:
        pid = await pool.fetchval(
            "SELECT id::text FROM public.graha_pipelines "
            "WHERE org_id=$1::uuid AND is_default=TRUE AND is_active=TRUE",
            org_id,
        )
    if not pid:
        return {"stages": [], "columns": {}}

    pipeline = await pool.fetchrow(
        "SELECT stages FROM public.graha_pipelines "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        pid, org_id,
    )
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")

    stages = pipeline["stages"]

    # The board is live work. An archived deal is off it — that is the whole
    # point of archiving — and there is no `include_archived` here for the same
    # reason: the Deals list is where the record is read.
    from services.deal_archive import archive_ready
    hide_archived = "AND d.archived_at IS NULL " if await archive_ready(pool) else ""
    rows = await pool.fetch(
        "SELECT d.id, d.title, d.value, d.stage, d.tags, d.assigned_to, "
        "d.expected_close_date, d.owner_id, d.client_id, "
        "c.name as contact_name, c.company as contact_company, "
        "cl.name as client_name, tr.name as territory_name, "
        # The card drew `owner_id.substring(0, 8)` — eight characters of an id,
        # which tells the reader nothing. A person is identified by their name.
        #
        # JOINED ON `assigned_to`, NOT ON `owner_id`, and that is the whole
        # correction. `graha_deals.owner_id` is a **uuid** while `users.user_id`
        # is TEXT, so `ON ow.user_id = d.owner_id` has no operator at all and
        # Postgres refuses the statement — it 500'd the entire kanban board, for
        # a column that migration 092 already recorded as unwritten and measured
        # at ZERO deals. So the join could never have produced a name even if it
        # had parsed. `assigned_to` is TEXT, is what the product actually writes,
        # and is who a reader means by the deal's owner.
        "COALESCE(NULLIF(btrim(ow.full_name), ''), NULLIF(btrim(ow.name), ''), 'Unnamed member') AS owner_name "
        "FROM public.graha_deals d "
        "LEFT JOIN public.graha_contacts c ON c.id = d.contact_id "
        # Scoped on `org_id` as well as `id`, as in `list_deals` and
        # `get_deal`: the card renders `cl.name`, and a join on the uuid alone
        # reaches whichever organisation's company holds it.
        "LEFT JOIN public.graha_clients cl "
        "       ON cl.id = d.client_id AND cl.org_id = d.org_id "
        # Org-scoped for the same reason as the client join above, and see
        # `list_deals`: `graha_territories.id` is unique table-wide, so the
        # id alone reaches another organisation's territory NAME. Phase
        # 7.1a — closed in the commit that puts values in the column.
        "LEFT JOIN public.graha_territories tr "
        "       ON tr.id = d.territory_id AND tr.org_id = d.org_id "
        "LEFT JOIN users ow ON ow.user_id = d.assigned_to "
        "WHERE d.org_id=$1::uuid AND d.pipeline_id=$2::uuid AND d.is_active=TRUE "
        + hide_archived +
        "ORDER BY d.created_at DESC",
        org_id, pid,
    )

    columns: dict[str, list] = {s: [] for s in stages}
    for r in rows:
        stage = r["stage"]
        if stage in columns:
            columns[stage].append(dict(r))
        else:
            columns.setdefault(stage, []).append(dict(r))

    return {"stages": stages, "columns": columns}


@router.get("/deals/{deal_id}")
async def get_deal(
    deal_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        # `cl.name` joins here too. This returned `client_id` and no
        # `client_name`, so a detail screen held a company uuid it was not
        # allowed to render and had nothing to draw. The two LIST endpoints
        # already carry this join; the single-record read was the one that did
        # not, which is why it only showed up when a detail sheet was built.
        #
        # Scoped on `org_id` as well as `id`: `graha_clients` has no composite
        # (id, org_id) constraint, so the join is the only thing enforcing
        # tenancy here.
        "SELECT d.*, c.name as contact_name, c.email as contact_email, "
        "c.company as contact_company, c.gstin as contact_gstin, "
        "cl.name as client_name "
        "FROM public.graha_deals d "
        "LEFT JOIN public.graha_contacts c ON c.id = d.contact_id "
        "LEFT JOIN public.graha_clients cl "
        "       ON cl.id = d.client_id AND cl.org_id = d.org_id "
        "WHERE d.id=$1::uuid AND d.org_id=$2::uuid",
        str(deal_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Deal not found")

    activities = await pool.fetch(
        "SELECT id, activity_type, title, scheduled_at, is_completed, created_at "
        "FROM public.graha_activities WHERE deal_id=$1::uuid ORDER BY created_at DESC LIMIT 30",
        str(deal_id),
    )
    return {"deal": dict(row), "activities": [dict(a) for a in activities]}


@router.patch("/deals/{deal_id}")
async def update_deal(
    deal_id: UUID,
    body: DealUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # ── THE ALLOWLIST AND THE MODEL NOW AGREE, BOTH WAYS ───────────────────
    #
    # This set and `DealUpdate` had drifted apart in BOTH directions and each
    # direction fails differently. An entry here with no field behind it is
    # dead permission — noisy but harmless, because nothing can ever match it.
    # A field on the model that is NOT here is the dangerous one: pydantic
    # accepts the value, the comprehension below drops it, and the route
    # answers 200. `lost_reason` and `client_id` were both in that second
    # state. `lost_reason` is now here, which is the entire fix for "the reason
    # a deal was lost can never be saved"; `client_id` is here too, so the
    # company on a deal stops being set-once-at-create.
    #
    # This set is also the ONLY thing standing between a request body key and
    # an interpolated SQL identifier a few lines down (`f"{k}=..."`). It is a
    # server-side allowlist in the sense CLAUDE.md means, and every addition to
    # it is a new column a client can write — hence one line of reasoning per
    # entry on the model rather than a quiet edit here.
    _DEAL_COLS = {
        "title", "contact_id", "client_id", "pipeline_id", "value", "stage",
        "probability", "expected_close_date", "assigned_to", "notes", "tags",
        "custom_data", "territory_id", "won_at", "lost_at", "lost_reason",
    }
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None and k in _DEAL_COLS}
    if not updates:
        raise HTTPException(400, "No fields to update")

    # ── EVERY FOREIGN ID IN A PATCH IS PROVEN TO BE THIS ORG'S ─────────────
    #
    # All four of these columns carry a non-composite foreign key, so the
    # database will happily accept another organisation's uuid in any of them.
    # A PATCH is if anything the easier attack than a create: the deal already
    # exists and is already the caller's, so only the ONE field being re-filed
    # has to be guessed, and `deal_detail` reads the joined name and email
    # straight back to the attacker in the response.
    #
    # `""` clears three of them — that is the deliberate "none" value the
    # SET-build binds through `NULLIF($n,'')::uuid`, and each resolver returns
    # "" unchanged for a falsy input rather than treating it as a bad id.
    if "territory_id" in updates:
        updates["territory_id"] = await resolve_contact_territory(
            pool, org_id, updates["territory_id"])
    if "client_id" in updates:
        # Strict, for the reason `create_deal` gives: this route is
        # authenticated, so a bad company id is a caller to be told, not a
        # public form submission to be salvaged.
        updates["client_id"] = await resolve_contact_company(
            pool, org_id, updates["client_id"])
    if "contact_id" in updates:
        updates["contact_id"] = await resolve_deal_contact(
            pool, org_id, updates["contact_id"])
    if "assigned_to" in updates:
        # `""` clears the owner and passes straight through, exactly as it does
        # for the three ids above; anything else must be a member of this org.
        updates["assigned_to"] = await resolve_deal_owner(
            pool, org_id, updates["assigned_to"])
    if "pipeline_id" in updates:
        # THE ONE THAT CANNOT BE CLEARED, and it is refused explicitly rather
        # than silently ignored. `create_deal` guarantees every deal is on a
        # pipeline — it bootstraps a default one rather than write NULL — and
        # `deals_kanban` selects on `pipeline_id`, so a deal with none has
        # quietly left every board in the organisation while still counting in
        # `list_deals` and in the CRM report. A 400 says so; dropping the key
        # would let a client believe it had cleared the field.
        if not updates["pipeline_id"]:
            raise HTTPException(400, "A deal must stay on a pipeline")
        updates["pipeline_id"] = await resolve_deal_pipeline(
            pool, org_id, updates["pipeline_id"])

    # -- CLOSING IS A TIMESTAMP, AND IT HAS TO BE ABLE TO UN-CLOSE ----------
    #
    # This stamped `won_at` on the way IN and cleared nothing on the way OUT,
    # so a deal moved to Won and then back to Proposal -- the ordinary shape of
    # a deal that slips -- kept its `won_at` forever.
    #
    # That is not cosmetic, because the stage string and the timestamp are not
    # interchangeable and the product has already chosen between them. Every
    # money figure reads the TIMESTAMP; `graha.pipeline_by_stage` says so by
    # name -- "the close is the won_at/lost_at timestamp, never a stage string,
    # because stage values are per-org text". So the re-opened deal sat in an
    # open column on the board and was subtracted from open pipeline in the
    # metric, in the client report and on the Dristi overview. Measured live
    # 2026-08-31: one deal, 750,000, open on screen and absent from the money.
    #
    # `None` rather than dropping the key: both columns are in `_DEAL_COLS`, the
    # `ts_fields` branch below binds the value straight through, and NULL is
    # precisely what "not won" means.
    #
    # The stage is authoritative here, as it already was for `probability` and
    # for `won_at` on the winning path -- a PATCH carrying `stage="Proposal"`
    # AND an explicit `won_at` is self-contradictory, and the half a person can
    # see on the board is the half that wins.
    if "stage" in updates:
        _stage = updates["stage"]
        if _stage == "Won":
            updates["won_at"] = datetime.now(timezone.utc)
            updates["lost_at"] = None
            updates["probability"] = 100
        elif _stage == "Lost":
            updates["lost_at"] = datetime.now(timezone.utc)
            updates["won_at"] = None
            updates["probability"] = 0
        else:
            # Re-opened. `probability` is deliberately NOT reset: 100 and 0 were
            # written BY the close, but any other number is the rep's own
            # estimate and this path has nothing better to replace it with.
            updates["won_at"] = None
            updates["lost_at"] = None

    date_fields = {"expected_close_date"}
    ts_fields = {"won_at", "lost_at"}
    jsonb_fields = {"custom_data"}
    sets = []
    params = [str(deal_id), org_id]
    idx = 3
    for k, v in updates.items():
        if k in date_fields:
            # `NULLIF(...,'')` BEFORE the cast. Without it an empty string
            # reaches `::date` and PgBouncer turns the parse error into an
            # instant 500 — so a close date could be set and never CLEARED from
            # any client, because the only value that means "clear" was the one
            # value that crashed. `update_contact` already carried this guard;
            # the deal path did not, and the asymmetry was invisible until a
            # mobile form tried to offer the button.
            sets.append(f"{k}=NULLIF(${idx},'')::date")
            params.append(v.isoformat() if hasattr(v, "isoformat") else (v or ""))
        elif k in ("client_id", "contact_id", "territory_id", "pipeline_id"):
            # Same guard, same reason. A uuid column cast from '' is a 500, so
            # the company and the PERSON on a deal could be set once and never
            # changed or cleared. `territory_id` joined them in Phase 7.1a and
            # `pipeline_id` joins them here, the moment it stopped being a dead
            # allowlist entry: it is a `uuid` column and the generic branch
            # below would have bound it a bare untyped `$n`, which is a 500 the
            # first time anyone tried to move a deal between boards. That it
            # was sitting in `_DEAL_COLS` for the entire life of the file
            # without a field is the only reason nobody ever hit it.
            # These belong HERE rather than in the generic else-branch below, which
            # binds a bare `$n`: an untyped text parameter into a `uuid` column
            # is the parse error PgBouncer turns into an instant 500 with no
            # useful log — `memory/incident_credits_untyped_sql` is the same
            # failure on `$1 + $2`.
            sets.append(f"{k}=NULLIF(${idx},'')::uuid")
            params.append(v or "")
        elif k in ts_fields:
            sets.append(f"{k}=${idx}")
            params.append(v)
        elif k in jsonb_fields:
            sets.append(f"{k}=${idx}::jsonb")
            params.append(json.dumps(v) if v is not None else None)
        elif k == "assigned_to":
            sets.append(f"{k}=NULLIF(${idx},'')")
            params.append(v)
        elif k == "tags":
            sets.append(f"{k}=${idx}")
            params.append(v if isinstance(v, list) else [])
        else:
            sets.append(f"{k}=${idx}")
            params.append(v)
        idx += 1
    sets.append("updated_at=NOW()")
    # In the SET list, not a second statement — the UPDATE below already runs
    # inside a transaction with the stage-change event, and splitting the
    # actor out would mean the row and the event could disagree about who did
    # it. `idx` is the next free placeholder after the loop; `params` grows
    # with it, and `$1`/`$2` (deal id, org id) are untouched.
    sets.append(f"updated_by=${idx}")
    params.append(user["user_id"])
    idx += 1

    # ── THE STAGE CHANGE IS AN EVENT, AND ONLY A REAL ONE ──────────────────
    #
    # `deal.stage_changed` was declared in the registry, offered by the builder
    # and emitted by nothing — so a rule on "a deal moves stage" could be built
    # and never fired. This is the call site it was missing.
    #
    # THE OLD STAGE HAS TO BE READ FIRST, and under `FOR UPDATE`: the event
    # carries `before.stage`, and reading it in a separate autocommitted
    # statement would let two people move the same deal at once and produce two
    # events that both claim the same origin. One transaction, one lock, one
    # truthful pair.
    #
    # AND ONLY WHEN IT ACTUALLY MOVED. `updates` carries whatever the client
    # sent; a PATCH that includes `stage` set to the value it already holds is
    # ordinary (the deal drawer submits the whole form), and announcing a move
    # that did not happen is exactly the noise this engine exists to avoid.
    from services.niyam.subjects import deal_stage_changed
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            _before = await _conn.fetchrow(
                "SELECT stage FROM public.graha_deals "
                "WHERE id=$1::uuid AND org_id=$2::uuid FOR UPDATE",
                str(deal_id), org_id,
            )
            _after = await _conn.fetchrow(
                f"UPDATE public.graha_deals SET {', '.join(sets)} "
                f"WHERE id=$1::uuid AND org_id=$2::uuid RETURNING *",
                *params,
            )
            if _after is not None and _before is not None \
                    and "stage" in updates and _before["stage"] != _after["stage"]:
                await deal_stage_changed(
                    _conn, org_id=org_id, actor_id=user["user_id"],
                    deal_id=_after["id"], old_stage=_before["stage"],
                    new_stage=_after["stage"], row=dict(_after),
                )
    return {"status": "updated"}


@router.delete("/deals/{deal_id}")
async def delete_deal(
    deal_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        # Who deleted it. The row stays (revenue reporting still counts it), so
        # nothing else in the database would ever say.
        "UPDATE public.graha_deals SET is_active=FALSE, updated_at=NOW(), "
        "updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        deal_id, UUID(org_id), user["user_id"],
    )
    return {"status": "deleted"}


@router.post("/deals/{deal_id}/archive")
async def archive_deal(
    deal_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Take a closed deal off the board now, without waiting out the week.

    NOT a delete: `is_active` is untouched, so every revenue figure keeps
    counting it. Refused for an open deal — archiving work that is still live
    is how a deal gets forgotten.
    """
    from services.deal_archive import CLOSED_STAGES, archive_ready
    pool = await get_pool()
    if not await archive_ready(pool):
        raise HTTPException(503, "Deal archiving is not available yet — "
                                 "migration 133 has not been applied "
                                 "to this database.")
    row = await pool.fetchrow(
        "SELECT stage FROM public.graha_deals "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        deal_id, UUID(org_id))
    if not row:
        raise HTTPException(404, "Deal not found")
    if row["stage"] not in CLOSED_STAGES:
        raise HTTPException(400, "Only a Won or Lost deal can be archived")
    await pool.execute(
        # Archiving is a judgement call — it takes a deal off the board early,
        # ahead of the seven-day sweep — so the person who made it belongs on
        # the row. The sweep itself is a cron job with no user and writes no
        # actor, which is the honest distinction: an archived deal with a NULL
        # `updated_by` was taken by the clock, one with a name was taken by a
        # person.
        "UPDATE public.graha_deals SET archived_at=NOW(), updated_at=NOW(), "
        "updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND archived_at IS NULL",
        deal_id, UUID(org_id), user["user_id"])
    return {"status": "archived"}


@router.post("/deals/{deal_id}/unarchive")
async def unarchive_deal(
    deal_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Put an archived deal back on the board — a deal reopened, or one the
    sweep took early."""
    from services.deal_archive import archive_ready
    pool = await get_pool()
    if not await archive_ready(pool):
        raise HTTPException(503, "Deal archiving is not available yet — "
                                 "migration 133 has not been applied "
                                 "to this database.")
    res = await pool.execute(
        # The mirror of the archive above: putting a deal back on the board is
        # the correction of somebody else's call, and both halves have to be
        # attributable or neither is.
        "UPDATE public.graha_deals SET archived_at=NULL, updated_at=NOW(), "
        "updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND archived_at IS NOT NULL",
        deal_id, UUID(org_id), user["user_id"])
    if res and res.endswith(" 0"):
        raise HTTPException(404, "Deal not found or not archived")
    return {"status": "unarchived"}


@router.get("/pipeline-summary")
async def pipeline_summary(
    pipeline_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    query = (
        "SELECT stage, COUNT(*) as count, COALESCE(SUM(value),0) as total_value "
        "FROM public.graha_deals "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
    )
    params: list = [org_id]
    if pipeline_id:
        query += "AND pipeline_id=$2::uuid "
        params.append(pipeline_id)
    query += "GROUP BY stage ORDER BY count DESC"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


# ── Activities ───────────────────────────────────────────────

@router.post("/activities")
async def create_activity(
    body: ActivityCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    valid_types = ("call", "email", "meeting", "note", "task")
    if body.activity_type not in valid_types:
        raise HTTPException(400, f"activity_type must be one of: {', '.join(valid_types)}")

    # BOTH PARENTS PROVEN TO BE THIS ORG'S. Neither foreign key on
    # `graha_activities` is composite with `org_id`, so an id guessed out of
    # another tenant was accepted and the note then appeared in that tenant's
    # deal drawer. See `resolve_deal_id` for why the child row's own `org_id`
    # does not make this safe.
    deal_id = await resolve_deal_id(pool, org_id, body.deal_id)
    contact_id = await resolve_deal_contact(pool, org_id, body.contact_id)

    row = await pool.fetchrow(
        "INSERT INTO public.graha_activities "
        "(org_id, deal_id, contact_id, activity_type, title, description, scheduled_at, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6, "
        " NULLIF($7,'')::timestamptz, $8) RETURNING id",
        org_id, deal_id, contact_id, body.activity_type,
        body.title, body.description, body.scheduled_at, user["user_id"],
    )
    # The RESOLVED id — `compute_lead_score` writes to the contact row, so the
    # unchecked body value here would be a cross-tenant write on its own.
    if contact_id:
        asyncio.ensure_future(compute_lead_score(pool, org_id, contact_id))
    return {"status": "created", "id": str(row["id"])}


@router.get("/activities")
async def list_activities(
    contact_id: Optional[str] = None,
    deal_id: Optional[str] = None,
    activity_type: Optional[str] = None,
    since: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """The activity log — or, with `?since=`, only what changed since then.

    The `created_by` visibility filter is NOT relaxed for a delta: it is a
    permission boundary, not a display filter, and a sync is not a way around
    one. `updated_at` is maintained by `trg_touch_activities` (migration 138),
    so completing an activity moves the stamp even though the UPDATE that does
    it never mentions the column.
    """
    from services.delta_sync import envelope, parse_since

    since_dt = parse_since(since)
    synced_at = datetime.now(timezone.utc)
    pool = await get_pool()
    # WHOSE activity it is, by NAME. The column was `created_by` alone, a bare
    # id, so no screen could say who logged the call — and an id is never what
    # a person is shown.
    #
    # ── WHY THE EMAIL RUNG IS GONE ────────────────────────────────────────
    # This line used to read `COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), 'Unnamed member')`. The
    # `u.email` fallback looked like defensive coding — always print SOMETHING
    # — and was the opposite: a user row with both name columns blank silently
    # printed that person's EMAIL ADDRESS into a table cell. Graha's actors
    # include portal clients, so the leak lands squarely on the platform-
    # privacy rule (Aekam must not see client emails, and a tenant's activity
    # log is not a directory of them either). It also cannot be caught by the
    # names-not-ids ratchet, which looks for id SHAPES; an email renders as a
    # perfectly plausible display name.
    #
    # `actor_select` stops at the two name columns and answers the "always
    # print something" worry properly, with `has_creator`: NULL name + TRUE
    # means "there is an actor here we can no longer resolve" (the UI shows
    # `unknown`), NULL name + FALSE means "nobody is recorded" (an em dash).
    # That is the distinction the email fallback was destroying.
    #
    # The join also gains its schema: `LEFT JOIN users u` was unqualified and
    # relied on `search_path`, which is the exact footgun migration 142 exists
    # to close.
    #
    # `updated=False`: `graha_activities` was deliberately left out of
    # migration 201 — it is an append-only event log, so it has no
    # `updated_by` to resolve and asking for one would be a column that does
    # not exist.
    query = (
        "SELECT a.id, a.deal_id, a.contact_id, a.activity_type, a.title, a.description, "
        "a.scheduled_at, a.completed_at, a.is_completed, a.created_by, a.created_at, a.updated_at, "
        + actor_select("a") +
        "COUNT(*) OVER() AS _total "
        "FROM public.graha_activities a "
        + actor_joins("a") +
        "WHERE a.org_id=$1::uuid "
    )
    params: list = [org_id]
    idx = 2

    # Who sees whose. A graha ADMIN — which `held_module_levels` already
    # resolves from the platform role, from org_owner/org_admin, and from an
    # `org_member_modules` grant — sees the whole unfiltered log. Everyone else
    # sees the activities they logged themselves.
    #
    # Filtered in SQL rather than after the fetch, because the LIMIT is applied
    # by the database: filtering afterwards would silently hand a user a short
    # page of their own rows out of the first 100 rows of everyone's.
    levels = await held_module_levels(user.get("user_id"), org_id, "graha")
    if "admin" not in levels:
        query += f"AND a.created_by=${idx} "
        params.append(user["user_id"])
        idx += 1
    # Qualified with `a.` now that `users` is joined — `created_at` exists on
    # BOTH tables, so the bare ORDER BY would be ambiguous and error.
    if contact_id:
        query += f"AND a.contact_id=${idx}::uuid "
        params.append(contact_id)
        idx += 1
    if deal_id:
        query += f"AND a.deal_id=${idx}::uuid "
        params.append(deal_id)
        idx += 1
    if activity_type:
        query += f"AND a.activity_type=${idx} "
        params.append(activity_type)
        idx += 1
    if since_dt is not None:
        params.append(since_dt)
        query += f"AND a.updated_at > ${len(params)} ORDER BY a.updated_at ASC LIMIT 100"
    else:
        query += "ORDER BY a.created_at DESC LIMIT 100"
    rows = await pool.fetch(query, *params)
    if since_dt is not None:
        return envelope([dict(r) for r in rows], since_dt, synced_at, limit=100)
    return _listed(rows, limit=100)


@router.patch("/activities/{activity_id}/complete")
async def complete_activity(
    activity_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE public.graha_activities SET is_completed=TRUE, completed_at=NOW() "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(activity_id), org_id,
    )
    return {"status": "completed"}


# ── Follow-ups ──────────────────────────────────────────────

@router.get("/follow-ups")
async def list_follow_ups(
    assigned_to: Optional[str] = None,
    contact_id: Optional[str] = None,
    deal_id: Optional[str] = None,
    is_completed: Optional[bool] = None,
    since: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Follow-ups — or, with `?since=`, only those changed since that moment.

    A delta does NOT apply the default `is_completed=FALSE`. Without `since`
    that filter is right: the screen is a to-do list and a done item does not
    belong on it. WITH `since` it is the bug — a follow-up completed on the web
    is precisely the change the phone needs, and hiding it leaves the item
    outstanding on the device for ever. The client applies its own view filter
    to what it receives.

    Deletions arrive separately: follow-ups are hard-deleted, and
    `trg_tombstone_follow_ups` (migration 138) records them for
    `GET /v1/sync/tombstones`.
    """
    from services.delta_sync import envelope, parse_since

    since_dt = parse_since(since)
    synced_at = datetime.now(timezone.utc)
    pool = await get_pool()
    query = (
        "SELECT f.id, f.title, f.description, f.due_at, f.remind_at, "
        "f.is_completed, f.completed_at, f.assigned_to, f.contact_id, f.deal_id, "
        "f.created_by, f.created_at, f.updated_at, "
        "c.name as contact_name, d.title as deal_title, "
        # `f.created_by` is already on the wire above and stays there (callers
        # compare it to the current user), but it is an id and cannot be shown.
        # These four columns are what the screen actually renders: who set the
        # follow-up and who last changed it, plus the two booleans that keep
        # "no actor" distinct from "actor we cannot resolve".
        + actor_select("f", updated=True) +
        "COUNT(*) OVER() AS _total "
        "FROM public.graha_follow_ups f "
        "LEFT JOIN public.graha_contacts c ON c.id = f.contact_id "
        "LEFT JOIN public.graha_deals d ON d.id = f.deal_id "
        + actor_joins("f", updated=True) +
        "WHERE f.org_id=$1::uuid "
    )
    params: list = [org_id]
    idx = 2

    if is_completed is None:
        # ...but never for a delta. See the docstring.
        if since_dt is None:
            query += "AND f.is_completed=FALSE "
    else:
        query += f"AND f.is_completed=${idx} "
        params.append(is_completed)
        idx += 1

    if assigned_to:
        query += f"AND f.assigned_to=${idx} "
        params.append(assigned_to)
        idx += 1

    if contact_id:
        query += f"AND f.contact_id=${idx}::uuid "
        params.append(contact_id)
        idx += 1

    if deal_id:
        query += f"AND f.deal_id=${idx}::uuid "
        params.append(deal_id)
        idx += 1

    if since_dt is not None:
        params.append(since_dt)
        query += f"AND f.updated_at > ${len(params)} ORDER BY f.updated_at ASC LIMIT 200"
    else:
        query += "ORDER BY f.due_at ASC LIMIT 200"
    rows = await pool.fetch(query, *params)
    if since_dt is not None:
        return envelope([dict(r) for r in rows], since_dt, synced_at, limit=200)
    return _listed(rows, limit=200)


@router.post("/follow-ups")
async def create_follow_up(
    body: FollowUpCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    assigned = body.assigned_to or user["user_id"]
    # BOTH PARENTS PROVEN TO BE THIS ORG'S, and this route is the sharpest of
    # the three: a follow-up is not just filed against the parent, it is picked
    # up by the reminder job and EMAILED. An unchecked `deal_id` therefore put
    # one firm's reminder text into another firm's record and out through their
    # notifications. Same non-composite foreign keys as everywhere else here.
    contact_id = await resolve_deal_contact(pool, org_id, body.contact_id)
    deal_id = await resolve_deal_id(pool, org_id, body.deal_id)
    due = datetime.fromisoformat(body.due_at) if body.due_at else None
    remind = datetime.fromisoformat(body.remind_at) if body.remind_at else None
    row = await pool.fetchrow(
        "INSERT INTO public.graha_follow_ups "
        "(org_id, contact_id, deal_id, title, description, due_at, remind_at, "
        " assigned_to, created_by) "
        "VALUES ($1::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, "
        " $6::timestamptz, $7::timestamptz, $8, $9) "
        "RETURNING id, title, due_at",
        org_id, contact_id, deal_id, body.title, body.description,
        due, remind, assigned, user["user_id"],
    )
    return {"status": "created", **dict(row)}


@router.patch("/follow-ups/{follow_up_id}/complete")
async def complete_follow_up(
    follow_up_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        # This statement never mentions `updated_at` and still moves it —
        # `trg_touch_follow_ups` (migration 138) does that, which is why the
        # delta sync can see a completion at all. That makes writing the actor
        # here MANDATORY rather than optional: without it the trigger advances
        # the stamp while `updated_by` keeps naming whoever last edited the
        # title, so the row would confidently attribute the completion to the
        # wrong person. A trigger cannot know who is on the request; only this
        # statement does.
        "UPDATE public.graha_follow_ups SET is_completed=TRUE, completed_at=NOW(), "
        "updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(follow_up_id), org_id, user["user_id"],
    )
    return {"status": "completed"}


@router.delete("/follow-ups/{follow_up_id}")
async def delete_follow_up(
    follow_up_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM public.graha_follow_ups WHERE id=$1::uuid AND org_id=$2::uuid",
        str(follow_up_id), org_id,
    )
    return {"status": "deleted"}


# ── Labels ──────────────────────────────────────────────────

@router.get("/labels")
async def list_labels(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, color, created_at FROM public.graha_labels "
        "WHERE org_id=$1::uuid ORDER BY name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/labels")
async def create_label(
    body: LabelCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "INSERT INTO public.graha_labels (org_id, name, color) "
            "VALUES ($1::uuid, $2, $3) RETURNING id, name, color",
            org_id, body.name, body.color,
        )
    except asyncpg.exceptions.UniqueViolationError:
        raise HTTPException(409, "Label with this name already exists")
    return {"status": "created", **dict(row)}


@router.delete("/labels/{label_id}")
async def delete_label(
    label_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM public.graha_labels WHERE id=$1::uuid AND org_id=$2::uuid",
        str(label_id), org_id,
    )
    return {"status": "deleted"}


@router.post("/contacts/{contact_id}/labels/{label_id}")
async def add_contact_label(
    contact_id: UUID,
    label_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    contact = await pool.fetchval(
        "SELECT id FROM public.graha_contacts WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        str(contact_id), org_id,
    )
    if not contact:
        raise HTTPException(404, "Contact not found")
    label = await pool.fetchval(
        "SELECT id FROM public.graha_labels WHERE id=$1::uuid AND org_id=$2::uuid",
        str(label_id), org_id,
    )
    if not label:
        raise HTTPException(404, "Label not found")

    try:
        await pool.execute(
            "INSERT INTO public.graha_contact_labels (contact_id, label_id) VALUES ($1::uuid, $2::uuid) "
            "ON CONFLICT DO NOTHING",
            str(contact_id), str(label_id),
        )
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(400, "Could not add label")
    return {"status": "added"}


@router.delete("/contacts/{contact_id}/labels/{label_id}")
async def remove_contact_label(
    contact_id: UUID,
    label_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM public.graha_contact_labels "
        "WHERE contact_id=$1::uuid AND label_id=$2::uuid "
        "AND contact_id IN (SELECT id FROM public.graha_contacts WHERE org_id=$3::uuid)",
        str(contact_id), str(label_id), org_id,
    )
    return {"status": "removed"}


# ── Lead Conversion ─────────────────────────────────────────

@router.post("/contacts/{contact_id}/convert")
async def convert_lead(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # The conversion and its `lead.converted` event share ONE transaction, and
    # the pre-check rides inside it under FOR UPDATE — the update_deal idiom:
    # two people converting the same lead at once must produce one conversion
    # and ONE event, not two events both claiming the same origin. A refusal
    # raises before the UPDATE, so nothing is written and nothing emits.
    from services.niyam.subjects import lead_converted
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row = await _conn.fetchrow(
                "SELECT id, contact_type FROM public.graha_contacts "
                "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE FOR UPDATE",
                str(contact_id), org_id,
            )
            if not row:
                raise HTTPException(404, "Contact not found")
            if row["contact_type"] == "customer":
                raise HTTPException(400, "Contact is already a customer")

            updated = await _conn.fetchrow(
                # `updated_by` rides in the same statement as the conversion,
                # inside the same transaction as the event. The event already
                # carries `actor_id`, but the event log is a separate stream a
                # tenant cannot query from the contact row — without this
                # column the contact itself still says whoever last edited a
                # phone number was the last person to touch it, which is false
                # from the moment the conversion commits.
                "UPDATE public.graha_contacts "
                "SET contact_type='customer', converted_at=NOW(), "
                "updated_at=NOW(), updated_by=$3 "
                "WHERE id=$1::uuid AND org_id=$2::uuid "
                "RETURNING *",
                str(contact_id), org_id, user["user_id"],
            )
            # The row AS CONVERTED — read back from the UPDATE, not the row we
            # checked — so `contact_type` is what the contact became and
            # `client_id` is the company it now belongs to.
            await lead_converted(_conn, org_id=org_id, actor_id=user["user_id"],
                                 contact_id=updated["id"], row=dict(updated))
    return {"status": "converted", "contact": dict(updated)}


# ── Today / Daily Action View ──────────────────────────────

@router.get("/today")
async def crm_today(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    role = user.get("role", "member")
    uid = user["user_id"]
    # Org-scoped: a CRM "today" view for one org must not widen because the
    # caller happens to hold the legacy admin claim in another.
    is_admin = await is_org_admin(uid, org_id)

    if is_admin:
        overdue_q = pool.fetch(
            "SELECT f.id, f.title, f.due_at, f.contact_id, c.name AS contact_name "
            "FROM public.graha_follow_ups f "
            "LEFT JOIN public.graha_contacts c ON c.id = f.contact_id "
            "WHERE f.org_id=$1::uuid AND f.due_at < NOW() AND NOT f.is_completed "
            "ORDER BY f.due_at ASC LIMIT 20",
            org_id,
        )
    else:
        overdue_q = pool.fetch(
            "SELECT f.id, f.title, f.due_at, f.contact_id, c.name AS contact_name "
            "FROM public.graha_follow_ups f "
            "LEFT JOIN public.graha_contacts c ON c.id = f.contact_id "
            "WHERE f.org_id=$1::uuid AND f.due_at < NOW() AND NOT f.is_completed "
            "AND f.assigned_to=$2 "
            "ORDER BY f.due_at ASC LIMIT 20",
            org_id, uid,
        )

    if is_admin:
        stale_q = pool.fetch(
            "SELECT d.id, d.title, d.value, d.stage, d.probability, "
            "d.updated_at, c.name AS contact_name "
            "FROM public.graha_deals d "
            "LEFT JOIN public.graha_contacts c ON c.id = d.contact_id "
            "LEFT JOIN LATERAL ("
            "  SELECT MAX(a.created_at) AS last_act FROM public.graha_activities a "
            "  WHERE a.deal_id = d.id"
            ") la ON TRUE "
            "WHERE d.org_id=$1::uuid AND d.is_active=TRUE "
            "AND d.stage NOT IN ('Won','Lost') "
            "AND COALESCE(la.last_act, d.created_at) < NOW() - INTERVAL '7 days' "
            "ORDER BY COALESCE(la.last_act, d.created_at) ASC LIMIT 15",
            org_id,
        )
    else:
        stale_q = pool.fetch(
            "SELECT d.id, d.title, d.value, d.stage, d.probability, "
            "d.updated_at, c.name AS contact_name "
            "FROM public.graha_deals d "
            "LEFT JOIN public.graha_contacts c ON c.id = d.contact_id "
            "LEFT JOIN LATERAL ("
            "  SELECT MAX(a.created_at) AS last_act FROM public.graha_activities a "
            "  WHERE a.deal_id = d.id"
            ") la ON TRUE "
            "WHERE d.org_id=$1::uuid AND d.is_active=TRUE "
            "AND d.stage NOT IN ('Won','Lost') AND d.assigned_to=$2 "
            "AND COALESCE(la.last_act, d.created_at) < NOW() - INTERVAL '7 days' "
            "ORDER BY COALESCE(la.last_act, d.created_at) ASC LIMIT 15",
            org_id, uid,
        )

    if is_admin:
        new_leads_q = pool.fetch(
            "SELECT id, name, email, phone, company, source, created_at "
            "FROM public.graha_contacts "
            "WHERE org_id=$1::uuid AND is_active=TRUE AND contact_type='lead' "
            "AND created_at > NOW() - INTERVAL '24 hours' "
            "ORDER BY created_at DESC LIMIT 20",
            org_id,
        )
    else:
        new_leads_q = pool.fetch(
            "SELECT id, name, email, phone, company, source, created_at "
            "FROM public.graha_contacts "
            "WHERE org_id=$1::uuid AND is_active=TRUE AND contact_type='lead' "
            "AND created_at > NOW() - INTERVAL '24 hours' AND assigned_to=$2 "
            "ORDER BY created_at DESC LIMIT 20",
            org_id, uid,
        )

    today_act_q = pool.fetch(
        "SELECT a.id, a.activity_type, a.title, a.scheduled_at, a.is_completed, "
        "a.deal_id, a.contact_id, c.name AS contact_name "
        "FROM public.graha_activities a "
        "LEFT JOIN public.graha_contacts c ON c.id = a.contact_id "
        "WHERE a.org_id=$1::uuid "
        "AND (DATE(a.scheduled_at) = CURRENT_DATE OR DATE(a.created_at) = CURRENT_DATE) "
        "ORDER BY COALESCE(a.scheduled_at, a.created_at) ASC LIMIT 30",
        org_id,
    )

    closures_q = pool.fetch(
        "SELECT d.id, d.title, d.value, d.stage, d.updated_at, c.name AS contact_name "
        "FROM public.graha_deals d "
        "LEFT JOIN public.graha_contacts c ON c.id = d.contact_id "
        "WHERE d.org_id=$1::uuid AND d.stage IN ('Won','Lost') "
        "AND d.updated_at > NOW() - INTERVAL '7 days' "
        "ORDER BY d.updated_at DESC LIMIT 15",
        org_id,
    )

    overdue, stale, new_leads, today_act, closures = await asyncio.gather(
        overdue_q, stale_q, new_leads_q, today_act_q, closures_q,
    )

    return {
        "overdue_followups": [dict(r) for r in overdue],
        "stale_deals": [dict(r) for r in stale],
        "new_leads": [dict(r) for r in new_leads],
        "todays_activities": [dict(r) for r in today_act],
        "recent_closures": [dict(r) for r in closures],
    }


# ── Contact Timeline ──────────────────────────────────────

@router.get("/contacts/{contact_id}/timeline")
async def contact_timeline(
    contact_id: UUID,
    cursor: Optional[str] = None,
    limit: int = Query(30, ge=1, le=100),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    cid = str(contact_id)

    cursor_filter = ""
    params: list = [cid, org_id]
    if cursor:
        params.append(cursor)
        cursor_filter = f" AND ts < ${len(params)}::timestamptz"

    params.append(limit)
    limit_param = f"${len(params)}"

    q = f"""
    SELECT * FROM (
        SELECT id, 'activity' AS type, title, activity_type AS subtype,
            COALESCE(scheduled_at, created_at) AS ts, NULL::numeric AS amount, NULL AS stage
        FROM public.graha_activities
        WHERE contact_id=$1::uuid AND org_id=$2::uuid

        UNION ALL

        SELECT id, 'followup' AS type, title, NULL AS subtype,
            due_at AS ts, NULL::numeric AS amount, NULL AS stage
        FROM public.graha_follow_ups
        WHERE contact_id=$1::uuid AND org_id=$2::uuid

        UNION ALL

        SELECT id, 'invoice' AS type, invoice_number AS title, payment_status AS subtype,
            created_at AS ts, total AS amount, NULL AS stage
        FROM public.ganit_invoices
        WHERE contact_id=$1::uuid AND org_id=$2::uuid

        UNION ALL

        SELECT id, 'deal' AS type, title, NULL AS subtype,
            created_at AS ts, value AS amount, stage
        FROM public.graha_deals
        WHERE contact_id=$1::uuid AND org_id=$2::uuid
    ) timeline
    WHERE 1=1{cursor_filter}
    ORDER BY ts DESC
    LIMIT {limit_param}
    """

    rows = await pool.fetch(q, *params)
    data = [dict(r) for r in rows]
    next_cursor = str(data[-1]["ts"].isoformat()) if data and len(data) == limit else None

    return {"data": data, "next_cursor": next_cursor}


# ── Contact → Projects ─────────────────────────────────────

@router.get("/contacts/{contact_id}/projects")
async def contact_projects(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    cid = str(contact_id)
    rows = await pool.fetch(
        "SELECT p.id, p.name, p.status, p.created_at "
        "FROM public.projects p "
        "WHERE p.org_id=$1::uuid AND p.contact_id=$2::uuid AND p.is_active=TRUE "
        "ORDER BY p.created_at DESC LIMIT 20",
        org_id, cid,
    )
    return {"data": [dict(r) for r in rows]}


# ── Inbound Lead Capture ──────────────────────────────────

import hmac
import hashlib
import os

_INBOUND_SECRET = os.environ.get("INBOUND_WEBHOOK_SECRET", "")

def _sanitize(val: str, max_len: int = 500) -> str:
    import re as _re
    val = _re.sub(r"<[^>]+>", "", val or "")
    return val.strip()[:max_len]


@router.post("/inbound-leads")
async def inbound_leads(request: Request):
    if not _INBOUND_SECRET:
        raise HTTPException(503, "Webhook not configured")
    body_bytes = await request.body()
    sig = request.headers.get("x-webhook-signature", "")
    expected = hmac.new(_INBOUND_SECRET.encode(), body_bytes, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(403, "Invalid webhook signature")
    payload = json.loads(body_bytes)

    sender = payload.get("from", payload.get("sender", ""))
    subject = payload.get("subject", "")
    body_text = payload.get("text", payload.get("html", payload.get("body", "")))
    to_addr = payload.get("to", "")

    pool = await get_pool()

    org_row = await pool.fetchrow(
        # `lead_capture_client_id` rides along beside the address that selected
        # this org: the company every lead arriving at that inbox belongs to,
        # for a firm whose capture address sits behind one client's portal. It
        # is the ONLY company this path will accept — see the INSERT below.
        "SELECT o.id, o.settings->>'lead_capture_client_id' AS lead_capture_client_id "
        "FROM public.organisations o "
        "WHERE o.settings->>'lead_capture_email' = $1 AND o.is_active=TRUE",
        to_addr.lower().strip(),
    )
    if not org_row:
        raise HTTPException(400, "No org found for this inbound address")

    org_id = str(org_row["id"])
    source, parsed = parse_lead_email(sender, subject, body_text)

    email_row = await pool.fetchrow(
        "INSERT INTO public.graha_inbound_emails "
        "(org_id, sender, subject, body_text, parsed_data, status) "
        "VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6) RETURNING id",
        org_id, _sanitize(sender, 200), _sanitize(subject, 300),
        body_text[:10000] if body_text else "",
        json.dumps(parsed) if parsed else "{}",
        "parsed" if parsed else "failed",
    )

    if not parsed:
        return {"status": "stored", "parsed": False, "email_id": str(email_row["id"])}

    name = _sanitize(parsed.get("name", "Unknown Lead"))
    phone = _sanitize(parsed.get("phone", ""), 20)
    email = _sanitize(parsed.get("email", ""), 200)
    company = _sanitize(parsed.get("company", parsed.get("city", "")))
    product = _sanitize(parsed.get("product", ""))

    # Exact-key dedupe at write time. Raw equality missed +91/spacing variants
    # of the same number; find_duplicates matches on the normalized keys.
    # Exact matches only here — fuzzy is never auto-merged, only reviewed.
    dupes = await find_duplicates(pool, org_id, email=email, phone=phone)
    existing = dupes[0] if dupes else None

    if existing:
        await pool.execute(
            "INSERT INTO public.graha_activities "
            "(org_id, contact_id, activity_type, title, description, created_by) "
            "VALUES ($1::uuid, $2::uuid, 'note', $3, $4, $5)",
            org_id, str(existing["id"]),
            f"New {source} enquiry: {product}" if product else f"New {source} enquiry",
            parsed.get("message", ""),
            "system",
        )
        await pool.execute(
            "UPDATE public.graha_inbound_emails SET status='duplicate', contact_id=$1::uuid WHERE id=$2::uuid",
            str(existing["id"]), str(email_row["id"]),
        )
        return {"status": "duplicate", "contact_id": str(existing["id"]), "email_id": str(email_row["id"])}

    # No ON CONFLICT here. Migration 022 declared a unique index on
    # (org_id, phone) that was never created in the live DB, so the old
    # ON CONFLICT (org_id, phone) clause had no matching index and Postgres
    # raised at plan time — every new inbound lead 500'd. Migration 024 drops
    # the intent deliberately: phone is not unique in a CRM (shared landlines,
    # soft-merged tombstones retain their number). The find_duplicates() check
    # above handles the dedupe; anything that races past it is caught by the
    # /contacts/duplicates review queue.
    # `source='import'`, `actor_id=None`: nobody clicked anything. The events
    # table CHECKs `source <> 'app' OR actor_id IS NOT NULL`, so inventing an
    # actor here would be the only way to call this an app action — and a rule
    # that reads "who added this lead" would then name a person who did not.
    #
    # ── `client_id`: NAMED BY THE ORG, NEVER BY THE SENDER ──────────────────
    # The column is written explicitly rather than left to default, because a
    # contact created with a NULL `client_id` can never be emailed again: the
    # Prachar audience resolver gates every send on `client_id IS NOT NULL`
    # under the ICAI bar on soliciting non-clients.
    #
    # The only company this path will accept is the one the ORG configured
    # beside its capture address. Nothing is read from the parsed email — a
    # stranger who could name their own company would be self-declaring as a
    # client, which is the one thing the ICAI gate exists to prevent. When the
    # org has named none the contact is written with no company, and that is
    # the CORRECT outcome for an unsolicited enquiry: an inbound stranger is a
    # prospect, and the firm may not market to them.
    #
    # `strict=False`: a webhook that starts refusing because a setting went
    # stale drops enquiries on the floor with nobody watching. See the helper.
    client_id = await resolve_contact_company(
        pool, org_id, org_row["lead_capture_client_id"] or "", strict=False)

    from services.niyam.subjects import contact_created
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            contact_row = await _conn.fetchrow(
                "INSERT INTO public.graha_contacts "
                "(org_id, name, email, phone, company, contact_type, source, notes, client_id) "
                "VALUES ($1::uuid, $2, $3, $4, $5, 'lead', $6, $7, NULLIF($8,'')::uuid) "
                "RETURNING *",
                org_id, name, email, phone, company, source,
                parsed.get("message", ""), client_id,
            )
            await contact_created(_conn, org_id=org_id, actor_id=None,
                                  contact_id=contact_row["id"],
                                  row=dict(contact_row), source="import")
    contact_id = str(contact_row["id"])

    await pool.execute(
        "UPDATE public.graha_inbound_emails SET contact_id=$1::uuid WHERE id=$2::uuid",
        contact_id, str(email_row["id"]),
    )

    if product:
        await pool.execute(
            "INSERT INTO public.graha_activities "
            "(org_id, contact_id, activity_type, title, description, created_by) "
            "VALUES ($1::uuid, $2::uuid, 'note', $3, $4, $5)",
            org_id, contact_id,
            f"{source} enquiry: {product}",
            parsed.get("message", ""),
            "system",
        )

    await pool.execute(
        "INSERT INTO public.graha_follow_ups "
        "(org_id, contact_id, title, due_at, assigned_to, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $5)",
        org_id, contact_id,
        f"Follow up on {source} lead: {name}",
        datetime.now(timezone.utc) + timedelta(days=3),
        "system",
    )

    log.info("Created lead from %s: %s (org=%s)", source, name, org_id)
    return {"status": "created", "contact_id": contact_id, "email_id": str(email_row["id"])}


# ── Inbound Email Log (admin only) ────────────────────────

@router.get("/inbound-emails")
async def list_inbound_emails(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, sender, subject, status, contact_id, created_at, "
        "COUNT(*) OVER() AS _total "
        "FROM public.graha_inbound_emails "
        "WHERE org_id=$1::uuid ORDER BY created_at DESC LIMIT 100",
        org_id,
    )
    return _listed(rows, limit=100)


@router.get("/inbound-emails/{email_id}")
async def get_inbound_email(
    email_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM public.graha_inbound_emails WHERE id=$1::uuid AND org_id=$2::uuid",
        str(email_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Email not found")
    return dict(row)


# ── Phase 1: Lead Scoring ──────────────────────────────────

SCORING_SIGNALS = {
    "has_phone": lambda c, **_: bool(c.get("phone")),
    "has_email": lambda c, **_: bool(c.get("email")),
    "source_indiamart": lambda c, **_: c.get("source") == "indiamart",
    "source_justdial": lambda c, **_: c.get("source") == "justdial",
    "source_website": lambda c, **_: c.get("source") in ("website", "web_form"),
}


async def compute_lead_score(pool, org_id: str, contact_id: str) -> tuple[int, list[str]]:
    rules = await pool.fetch(
        "SELECT signal, points FROM public.graha_scoring_rules "
        "WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    if not rules:
        return 0, []

    contact = await pool.fetchrow(
        "SELECT * FROM public.graha_contacts WHERE id=$1::uuid AND org_id=$2::uuid",
        contact_id, org_id,
    )
    if not contact:
        return 0, []
    c = dict(contact)

    deal_count = await pool.fetchval(
        "SELECT COUNT(*) FROM public.graha_deals WHERE contact_id=$1::uuid AND is_active=TRUE",
        contact_id,
    )
    best_stage = await pool.fetchval(
        "SELECT stage FROM public.graha_deals WHERE contact_id=$1::uuid AND is_active=TRUE "
        "ORDER BY CASE stage WHEN 'Negotiation' THEN 4 WHEN 'Proposal' THEN 3 "
        "WHEN 'Qualified' THEN 2 WHEN 'New' THEN 1 ELSE 0 END DESC LIMIT 1",
        contact_id,
    )
    has_high_value = await pool.fetchval(
        "SELECT EXISTS(SELECT 1 FROM public.graha_deals WHERE contact_id=$1::uuid "
        "AND is_active=TRUE AND value >= 100000)",
        contact_id,
    )
    recent_activity = await pool.fetchval(
        "SELECT EXISTS(SELECT 1 FROM public.graha_activities WHERE contact_id=$1::uuid "
        "AND created_at > NOW() - INTERVAL '7 days')",
        contact_id,
    )
    activity_types = await pool.fetch(
        "SELECT DISTINCT activity_type FROM public.graha_activities WHERE contact_id=$1::uuid",
        contact_id,
    )
    act_set = {r["activity_type"] for r in activity_types}
    overdue_fu = await pool.fetchval(
        "SELECT EXISTS(SELECT 1 FROM public.graha_follow_ups WHERE contact_id=$1::uuid "
        "AND NOT is_completed AND due_at < NOW())",
        contact_id,
    )

    dynamic_signals = {
        "has_deal": deal_count > 0,
        "multiple_deals": deal_count >= 2,
        "deal_qualified": best_stage == "Qualified",
        "deal_proposal": best_stage == "Proposal",
        "deal_negotiation": best_stage == "Negotiation",
        "high_value_deal": has_high_value,
        "activity_recent_7d": recent_activity,
        "activity_call": "call" in act_set,
        "activity_meeting": "meeting" in act_set,
        "followup_overdue": overdue_fu,
    }

    score = 0
    reasons = []
    for rule in rules:
        sig = rule["signal"]
        pts = rule["points"]
        fn = SCORING_SIGNALS.get(sig)
        if fn:
            if fn(c):
                score += pts
                reasons.append(f"+{pts} {sig}" if pts > 0 else f"{pts} {sig}")
        elif sig in dynamic_signals:
            if dynamic_signals[sig]:
                score += pts
                reasons.append(f"+{pts} {sig}" if pts > 0 else f"{pts} {sig}")

    score = max(0, min(100, score))
    # ── NO `updated_by` HERE, DELIBERATELY ────────────────────────────────
    # This is the only UPDATE in the file that moves `updated_at` and leaves
    # `updated_by` alone, and it has to be. Scoring is not an edit a person
    # made: it is derived from activity counts and re-derived in bulk by
    # `/contacts/rescore-all`, which walks EVERY contact in the org. Stamping
    # the caller's id here would rewrite the last-editor of the entire contact
    # book to whoever happened to press Rescore — the audit column would be
    # destroyed by the one action least worth recording. The alternative,
    # threading a `user` argument down into this helper so it could be written,
    # buys nothing: there is no honest value to write, because no person edited
    # the row. `updated_at` still moves, which is correct — the row DID change
    # and the delta sync must ship it.
    await pool.execute(
        "UPDATE public.graha_contacts SET lead_score=$1, lead_score_reasons=$2::jsonb, updated_at=NOW() "
        "WHERE id=$3::uuid AND org_id=$4::uuid",
        score, json.dumps(reasons), contact_id, org_id,
    )
    return score, reasons


@router.post("/contacts/{contact_id}/rescore")
async def rescore_contact(
    contact_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    score, reasons = await compute_lead_score(pool, org_id, str(contact_id))
    return {"score": score, "reasons": reasons}


@router.post("/contacts/rescore-all")
async def rescore_all_contacts(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    contacts = await pool.fetch(
        "SELECT id FROM public.graha_contacts WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    count = 0
    for c in contacts:
        await compute_lead_score(pool, org_id, str(c["id"]))
        count += 1
    return {"status": "rescored", "count": count}


@router.post("/contacts/route-all")
async def route_all_contacts(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Backfill: route every unfiled contact through PIN -> territory -> rep.

    ── A ROUTE, DELIBERATELY, AND NOT A MIGRATION ───────────────────────────

    Migrations are pre-approved in this repo; rewriting live rows is NOT
    (`memory/migrations_pre_approved`). This writes `territory_id` and possibly
    `assigned_to` on hundreds of real contacts belonging to a real firm, and
    staging shares one Supabase database with production — so it has to be
    something a named person presses, in their own org, having decided that the
    territories are right. A migration would have done it to every org on the
    next deploy, before anyone had drawn a single PIN list.

    Modelled on `rescore_all_contacts` above, down to the `is_org_admin` gate.

    ── WHAT IT WILL NOT DO ──────────────────────────────────────────────────

    It never overwrites a territory a person already chose — `route_contact`
    returns `kept` for those and they are counted, not touched. It never
    reassigns a contact that already has an owner. And a PIN no territory
    claims routes nowhere and is not an error: on the day this shipped that was
    ALL 41 routable contacts in Unicode Group, because no live territory
    carried a single PIN.

    The response is deliberately counts and NAMES. It does not return contact
    ids, and `by_territory` is keyed by territory name — a backfill report is
    read by a person, and a uuid identifies nobody.
    """
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()

    report = {
        "status": "routed",
        "count": 0,                 # newly given a territory by this run
        "considered": 0,            # live contacts examined
        "already_filed": 0,         # a person had chosen a territory already
        "with_a_pin": 0,            # the ladder found a usable PIN
        "no_territory_claims_it": 0,
        "assigned_a_rep": 0,
        "failed": 0,
        "by_territory": {},
        "overlaps": [],
    }

    # ONE connection for the whole backfill, and one territory read for the
    # whole backfill. `route_contact` needs a Connection rather than a Pool —
    # it opens a transaction per contact so that a failure at contact 200 keeps
    # the first 199 — and re-reading 18 territories 288 times is how a loop
    # that "just works" becomes a request that times out.
    async with pool.acquire() as conn:
        territories = await territory_routing.load_territories(conn, org_id)
        rows = await conn.fetch(territory_routing.PIN_LADDER_ALL, org_id)
        report["considered"] = len(rows)
        for r in rows:
            if r["territory_id"]:
                report["already_filed"] += 1
                continue
            # THE PRE-FILTER IS NOT REDUNDANT WITH `route_contact`, which does
            # the same two steps again for the contact it is handed. It is what
            # stops the route opening a transaction per contact for the ones
            # that were never going to route — the ordinary case, and on the
            # day this shipped the case for ALL 41 in Unicode Group. It also
            # buys the two honest denominators in the report: how many have a
            # PIN, and how many of those no territory claims.
            pin, _source = territory_routing.pin_for_row(r)
            if not pin:
                continue
            report["with_a_pin"] += 1
            if not territory_routing.territories_for_pin(territories, pin):
                report["no_territory_claims_it"] += 1
                continue
            out = await territory_routing.route_contact(
                conn, org_id, r["contact_id"], territories=territories)
            if out["error"]:
                report["failed"] += 1
                continue
            if not out["routed"]:
                continue
            report["count"] += 1
            name = out["territory_name"]
            report["by_territory"][name] = report["by_territory"].get(name, 0) + 1
            if out["assigned_to"]:
                report["assigned_a_rep"] += 1
            if out["overlapping"] and len(report["overlaps"]) < 20:
                report["overlaps"].append(
                    {"pincode": out["pin"], "territories": out["overlapping"]})
    return report


@router.get("/scoring-rules")
async def list_scoring_rules(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, signal, points, description, is_active FROM public.graha_scoring_rules "
        "WHERE org_id=$1::uuid ORDER BY points DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


class ScoringRuleUpdate(BaseModel):
    points: int | None = None
    is_active: bool | None = None


@router.patch("/scoring-rules/{rule_id}")
async def update_scoring_rule(
    rule_id: UUID,
    body: ScoringRuleUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    _RULE_COLS = {"points", "is_active"}
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None and k in _RULE_COLS}
    if not updates:
        raise HTTPException(400, "No fields to update")
    sets = []
    params = [str(rule_id), org_id]
    idx = 3
    for k, v in updates.items():
        sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1
    await pool.execute(
        f"UPDATE public.graha_scoring_rules SET {', '.join(sets)} "
        f"WHERE id=$1::uuid AND org_id=$2::uuid",
        *params,
    )
    return {"status": "updated"}


# ── Phase 1: Sales Automations ─────────────────────────────

# ── Phase 3: Sales Reports ─────────────────────────────────

@router.get("/reports/pipeline-velocity")
async def report_pipeline_velocity(
    days: int = Query(30, ge=7, le=365),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT stage, COUNT(*) as count, COALESCE(SUM(value),0) as total_value, "
        "COALESCE(AVG(value),0) as avg_value, "
        "AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/86400)::int as avg_days_in_stage "
        "FROM public.graha_deals "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND created_at > NOW() - ($2 || ' days')::interval "
        "GROUP BY stage ORDER BY count DESC",
        org_id, str(days),
    )
    return {"data": [dict(r) for r in rows], "period_days": days}


@router.get("/reports/conversion")
async def report_conversion(
    days: int = Query(90, ge=7, le=365),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    # THE SCREEN AND THE DOWNLOADED REPORT MUST COUNT THE SAME DEALS.
    # `services/crm_report.py` was corrected on 2026-08-23 to window won value
    # on `won_at`; this endpoint is the screen behind the same figures and it
    # had the identical defect — five separate `created_at > cutoff` queries,
    # one of which summed `Won` value. A screen that disagrees with the
    # document it generates is worse than a screen with no figures, because the
    # reader cannot tell which one lied (the same argument `gst_period` makes
    # for there being exactly one implementation of GSTR-3B).
    #
    # Measured live 2026-08-22, last 90 days: E2E Rs53,13,648 shown against
    # Rs66,37,948 actually won; Unicode Group Rs11,22,500 against Rs15,72,500.
    # On the financial year to date Unicode is 39% low.
    #
    # Five round trips collapse to one, and BOTH cohorts are returned and named
    # so the UI can label rather than guess:
    #   · `total_deals` / `cohort_won` / `cohort_lost` / `open` /
    #     `conversion_rate` — deals OPENED in the window, and where they stand
    #     today. The rate must divide those two or it straddles populations.
    #   · `won` / `lost` / `won_value` / `avg_cycle_days` — deals CLOSED in the
    #     window, on `won_at` / `lost_at`.
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    row = await pool.fetchrow(
        "SELECT COUNT(*) FILTER (WHERE created_at > $2) AS total_deals, "
        "  COUNT(*) FILTER (WHERE stage='Won'  AND created_at > $2) AS cohort_won, "
        "  COUNT(*) FILTER (WHERE stage='Lost' AND created_at > $2) AS cohort_lost, "
        "  COUNT(*) FILTER (WHERE stage='Won'  AND won_at  > $2) AS won, "
        "  COUNT(*) FILTER (WHERE stage='Lost' AND lost_at > $2) AS lost, "
        "  COALESCE(SUM(value) FILTER (WHERE stage='Won' AND won_at > $2), 0) "
        "    AS won_value, "
        "  COUNT(*) FILTER (WHERE stage='Won'  AND won_at  IS NULL) AS won_undated, "
        "  COUNT(*) FILTER (WHERE stage='Lost' AND lost_at IS NULL) AS lost_undated, "
        "  AVG(EXTRACT(EPOCH FROM (won_at - created_at))/86400)"
        "    FILTER (WHERE stage='Won' AND won_at > $2)::int AS avg_cycle_days "
        "FROM public.graha_deals WHERE org_id=$1::uuid",
        org_id, cutoff,
    )
    r = dict(row) if row else {}
    total = int(r.get("total_deals") or 0)
    cohort_won = int(r.get("cohort_won") or 0)
    cohort_lost = int(r.get("cohort_lost") or 0)
    return {
        # The created cohort.
        "total_deals": total,
        "cohort_won": cohort_won,
        "cohort_lost": cohort_lost,
        "open": total - cohort_won - cohort_lost,
        "conversion_rate": round(cohort_won / total * 100, 1) if total else 0,
        # Closed in the window. `won` and `lost` keep their old names because
        # the UI reads them, but they now answer the question the label on the
        # screen has always claimed to be answering.
        "won": int(r.get("won") or 0),
        "lost": int(r.get("lost") or 0),
        "won_value": float(r.get("won_value") or 0),
        "avg_cycle_days": int(r.get("avg_cycle_days") or 0),
        # Rows that belong to no period, carried rather than absorbed. 0 of 33
        # wins and 0 of 22 losses today; the field exists so the first undated
        # one is visible instead of quietly shrinking a total.
        "won_undated": int(r.get("won_undated") or 0),
        "lost_undated": int(r.get("lost_undated") or 0),
        "period_days": days,
        # What each half counts, IN the payload, so a renderer cannot file a
        # closed-in-period figure under an opened-in-period heading.
        "basis": {
            "opened_in_period": ["total_deals", "cohort_won", "cohort_lost",
                                 "open", "conversion_rate"],
            "closed_in_period": ["won", "lost", "won_value", "avg_cycle_days"],
        },
    }


@router.get("/reports/rep-performance")
async def report_rep_performance(
    days: int = Query(30, ge=7, le=365),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    # Same correction as `/reports/conversion` above, and it matters more here
    # because these figures sit against a person. `total_deals` is what was
    # ROUTED to them in the window; `won` / `lost` / `won_value` are what they
    # CLOSED in it. Under a single `created_at` window a rep who closed a long
    # deal opened before the window showed zero beside their own name.
    rows = await pool.fetch(
        # THE NAME, not the id. This endpoint's own comment two lines up says
        # "these figures sit against a person" — and the screen was drawing
        # `assigned_to?.slice(0, 12)`, twelve characters of a `users.user_id`,
        # which identifies nobody. `services/crm_report.py` has joined `users`
        # for the DOWNLOADABLE version of this same report since it was written,
        # so the file a customer sends to their partner carried names while the
        # screen they read it off did not.
        #
        # The ladder stops at `name` and never reaches `.email`: the owner ruled
        # on 2026-08-23 that a display ladder must never end at an email address,
        # and `tests/test_audit_actors.py` walks the whole backend refusing one
        # that does.
        "SELECT d.assigned_to, "
        f"{_USER_NAME_SQL} AS assigned_to_name, "
        "COUNT(*) FILTER (WHERE d.created_at > $2) as total_deals, "
        "COUNT(*) FILTER (WHERE d.stage='Won'  AND d.won_at  > $2) as won, "
        "COUNT(*) FILTER (WHERE d.stage='Lost' AND d.lost_at > $2) as lost, "
        "COALESCE(SUM(d.value) FILTER (WHERE d.stage='Won' AND d.won_at > $2), 0) "
        "  as won_value, "
        # Average size of what was ROUTED in the window, not of what closed:
        # it is the allocation figure sitting beside the outcome figures.
        "COALESCE(AVG(d.value) FILTER (WHERE d.created_at > $2), 0) as avg_deal_value "
        "FROM public.graha_deals d "
        # LEFT, so a rep whose account has been removed still shows their
        # numbers under 'Unnamed member' rather than dropping out of the report
        # and quietly changing the totals.
        "LEFT JOIN users u ON u.user_id = d.assigned_to "
        "WHERE d.org_id=$1::uuid AND d.assigned_to IS NOT NULL "
        f"GROUP BY d.assigned_to, {_USER_NAME_SQL} "
        # The query now spans the table, so a rep with nothing at all in the
        # window would otherwise print as a line of noughts against their name.
        "HAVING COUNT(*) FILTER (WHERE d.created_at > $2) > 0 "
        "    OR COUNT(*) FILTER (WHERE d.stage='Won'  AND d.won_at  > $2) > 0 "
        "    OR COUNT(*) FILTER (WHERE d.stage='Lost' AND d.lost_at > $2) > 0 "
        "ORDER BY won_value DESC",
        org_id, cutoff,
    )
    return {"data": [dict(r) for r in rows], "period_days": days}


@router.get("/reports/forecast")
async def report_forecast(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT stage, COUNT(*) as count, "
        "COALESCE(SUM(value),0) as total_value, "
        "COALESCE(SUM(value * probability / 100.0),0) as weighted_value "
        "FROM public.graha_deals "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND stage NOT IN ('Won','Lost') "
        "GROUP BY stage ORDER BY weighted_value DESC",
        org_id,
    )
    total_weighted = sum(float(r["weighted_value"]) for r in rows)
    total_pipeline = sum(float(r["total_value"]) for r in rows)
    return {
        "stages": [dict(r) for r in rows],
        "total_pipeline": round(total_pipeline, 2),
        "weighted_forecast": round(total_weighted, 2),
    }


@router.get("/reports/source-analysis")
async def report_source_analysis(
    days: int = Query(90, ge=7, le=365),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = await pool.fetch(
        "SELECT COALESCE(c.source, 'unknown') as source, "
        "COUNT(*) as leads, "
        "COUNT(d.id) as deals, "
        "COUNT(d.id) FILTER (WHERE d.stage='Won') as won, "
        "COALESCE(SUM(d.value) FILTER (WHERE d.stage='Won'), 0) as won_value "
        "FROM public.graha_contacts c "
        "LEFT JOIN public.graha_deals d ON d.contact_id = c.id AND d.is_active=TRUE "
        "WHERE c.org_id=$1::uuid AND c.created_at > $2 AND c.is_active=TRUE "
        "GROUP BY COALESCE(c.source, 'unknown') ORDER BY leads DESC",
        org_id, cutoff,
    )
    return {"data": [dict(r) for r in rows], "period_days": days}


@router.get("/reports/download")
async def download_crm_report(
    days: int = Query(90, ge=7, le=365),
    fmt: str = Query("pdf"),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """The five CRM reports as one file. PDF, Excel or CSV.

    Approved by the owner 2026-08-09 with the plan in
    `docs/proposals/47-reports-download.html`. The five reports were computed
    and could not leave the screen.

    The BY-PERSON section follows the same rule the screen does: rep performance
    is admin-only, and a member who cannot see per-person numbers gets a report
    without that section rather than a 403 on the whole download.
    """
    from urllib.parse import quote

    from fastapi.responses import StreamingResponse

    from services import crm_report

    if fmt not in crm_report.FORMATS:
        raise HTTPException(400, f"fmt must be one of {', '.join(crm_report.FORMATS)}")

    pool = await get_pool()
    levels = await held_module_levels(user.get("user_id"), org_id, "graha")
    data = await crm_report.gather(pool, org_id, days, include_reps="admin" in levels)

    try:
        content, media_type, ext = crm_report.render(data, fmt)
    except RuntimeError as exc:
        # WeasyPrint missing on the host. Say which format is unavailable rather
        # than 500ing — Excel and CSV still work.
        raise HTTPException(503, str(exc)) from exc

    slug = re.sub(r"[^a-z0-9\-]", "",
                  (data["org"].get("name") or "crm").lower().replace(" ", "-")) or "crm"
    stamp = data["generated_at"].strftime("%Y-%m-%d")
    filename = quote(f"Kartavaya-{slug}-crm-{stamp}.{ext}", safe="")
    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )


# ── Phase 3: Territories ──────────────────────────────────

class TerritoryCreate(BaseModel):
    name: str
    description: str = ""
    assigned_users: list[str] = []
    rules: dict = {}


@router.get("/territories")
async def list_territories(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # `assigned` carries the NAMES. `assigned_users` stays because it is what
    # the form posts back and what round-robin reads, but the screen had nothing
    # else to draw and was rendering `u.slice(0, 12)` — twelve characters of a
    # UUID, which identifies nobody. A person is identified by their name.
    rows = await pool.fetch(
        "SELECT t.id, t.name, t.description, t.assigned_users, t.rules, "
        "       t.round_robin_index, t.is_active, "
        "       COALESCE(("
        "         SELECT json_agg(json_build_object("
        "                  'user_id', u.user_id, "
        "                  'name', COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), 'Unnamed member')) "
        "                ORDER BY COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), 'Unnamed member')) "
        "         FROM users u WHERE u.user_id::text = ANY("
        "               SELECT unnest(t.assigned_users)::text)"
        "       ), '[]'::json) AS assigned "
        "FROM public.graha_territories t "
        "WHERE t.org_id=$1::uuid AND t.is_active=TRUE ORDER BY t.name",
        org_id,
    )
    out = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("assigned"), str):
            d["assigned"] = json.loads(d["assigned"])
        out.append(d)
    return {"data": out}


async def _validated_territory_users(pool, org_id: str, user_ids: list[str]) -> list[str]:
    """Every id must belong to a member of THIS organisation.

    The form used to be a free-text "User ID" box, so whatever was typed went
    into the array — and then out again into `deals.assigned_to` via
    round-robin, assigning leads to a person who does not exist. The picker is a
    dropdown now; this is the half of that fix the server owes, because a
    dropdown is a convenience and a predicate is a guarantee.
    """
    if not user_ids:
        return []
    rows = await pool.fetch(
        "SELECT DISTINCT user_id FROM public.user_roles "
        "WHERE org_id=$1::uuid AND user_id = ANY($2::text[])",
        org_id, list(user_ids))
    known = {r["user_id"] for r in rows}
    unknown = [u for u in user_ids if u not in known]
    if unknown:
        raise HTTPException(400, f"{len(unknown)} of those people are not in this "
                                 "organisation")
    return [u for u in user_ids if u in known]


def _territory_write_error(exc: Exception) -> HTTPException:
    """`assigned_users` was `uuid[]` until migration 134, and `users.user_id` is
    TEXT — so on a database without that migration a real id raises
    invalid-input-syntax from asyncpg. Applied here on 2026-08-09; kept because a
    fresh database reaches this code before the migration does. Say which
    migration, rather than 500ing."""
    if isinstance(exc, asyncpg.exceptions.DataError) or "invalid input syntax" in str(exc):
        return HTTPException(503, "Assigning people to a territory is not available "
                                  "yet — migration 134 has "
                                  "not been applied to this database.")
    raise exc


@router.post("/territories")
async def create_territory(
    body: TerritoryCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    members = await _validated_territory_users(pool, org_id, body.assigned_users)
    try:
        row = await pool.fetchrow(
            "INSERT INTO public.graha_territories (org_id, name, description, assigned_users, rules) "
            "VALUES ($1::uuid, $2, $3, $4, $5::jsonb) RETURNING id, name",
            org_id, body.name, body.description, members,
            json.dumps(body.rules),
        )
    except Exception as exc:  # noqa: BLE001 — re-raised unless it is the migration
        raise _territory_write_error(exc) from exc
    return {"status": "created", **dict(row)}


@router.patch("/territories/{territory_id}")
async def update_territory(
    territory_id: UUID,
    body: TerritoryCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    members = await _validated_territory_users(pool, org_id, body.assigned_users)
    try:
        await pool.execute(
            "UPDATE public.graha_territories SET name=$1, description=$2, assigned_users=$3, "
            "rules=$4::jsonb WHERE id=$5::uuid AND org_id=$6::uuid",
            body.name, body.description, members,
            json.dumps(body.rules), str(territory_id), org_id,
        )
    except Exception as exc:  # noqa: BLE001 — re-raised unless it is the migration
        raise _territory_write_error(exc) from exc
    return {"status": "updated"}


@router.delete("/territories/{territory_id}")
async def delete_territory(
    territory_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    await pool.execute(
        "UPDATE public.graha_territories SET is_active=FALSE "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(territory_id), org_id,
    )
    return {"status": "deleted"}


@router.post("/territories/{territory_id}/assign-next")
async def territory_round_robin(
    territory_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Whose turn is it — the manual button, over the same round-robin routing
    uses.

    THE BODY MOVED, THE CONTRACT DID NOT. `services.territory_routing.
    assign_next_user` is now the only implementation of "whose turn is it", and
    this route maps its two failure reasons onto the same 404 and 400 it has
    always answered. Before 2026-08-27 this endpoint had ZERO callers in the
    repo; Phase 7.1 made it the mechanism that hands an incoming lead to a rep,
    and two copies of the rule — one for the button, one for the automatic
    path — would have drifted on the first change. What they would disagree
    about is who gets paid for a lead.
    """
    pool = await get_pool()
    turn = await territory_routing.assign_next_user(pool, org_id, str(territory_id))
    if turn["reason"] == territory_routing.NO_TERRITORY:
        raise HTTPException(404, "Territory not found")
    if turn["reason"] == territory_routing.NO_MEMBERS:
        raise HTTPException(400, "Territory has no assigned users")
    return {"assigned_user": turn["user"], "index": turn["index"]}


@router.get("/territories/{territory_id}/geometry")
async def territory_geometry(
    territory_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """The shapes of the PINs this territory claims — Phase 7.3.

    ── THE RESPONSE IS FOUR BUCKETS AND THEY MUST NOT BE MERGED ─────────────

        features      GeoJSON, one per PIN that has a published boundary. Each
                      names its own PIN in `properties.pincode`.
        matched       a COUNT, not a list — the PINs are already named above.
        unmatched     PINs the dataset publishes no boundary for. 58 PINs in
                      the government's own directory are in this state, so it
                      is ordinary and not an error.
        unavailable   PINs we could not look up because R2 did not answer. WE
                      DO NOT KNOW whether a boundary exists.
        invalid       entries that are not PINs at all — 'NW1 245', a blank, a
                      city name. Named, never silently dropped, because a
                      territory that claims five things and routes on four
                      must be able to say which one it lost.

    `unavailable` exists as its own bucket because the alternative is the map
    telling a customer "there is no shape for 110001" when the truth is that
    our object store is down. `storage.download_file` cannot make that
    distinction — it answers `None` for a missing key and for an outage alike —
    which is why `services/pin_boundaries.py` reads R2 itself.

    ── WHAT IS NOT AN ERROR ─────────────────────────────────────────────────

    A territory with no PINs, a territory whose PINs are all unmatched, and a
    total R2 outage all answer **200**. A 503 would take the territory's name,
    its `invalid` list and the count it claims down with it, and those are
    exactly what a person needs to see when the shapes will not draw. The
    frontend decides what to say from `unavailable` being non-empty; it must
    not infer anything from `features` being empty.

    The only 404 is a territory that is not this organisation's, or is
    soft-deleted.

    ── THE ARITHMETIC A CALLER CAN ASSERT ───────────────────────────────────

        matched + len(unmatched) + len(unavailable) == claimed

    `claimed` is what ROUTING sees — `Territory.pincodes`, normalised and
    deduplicated — so it differs from the number of entries the customer typed
    by exactly the invalid ones and the duplicates. PHASE-7 §7.3's acceptance is
    written as `features.length + unmatched.length === rules.pincodes.length`,
    which is the same statement only when nothing is invalid, nothing is
    repeated and R2 is up; the form above holds in every case.
    """
    pool = await get_pool()

    # `load_territories` rather than a fresh SELECT: its predicates are
    # org-scoped AND is_active-scoped and were reasoned about in 7.1, and a new
    # single-row lookup here would be new predicates in the exact place PHASE-7
    # §7.1a found three cross-tenant leaks. It also means the name this endpoint
    # reports and the PIN set it counts are the same ones routing uses.
    territories = await territory_routing.load_territories(pool, org_id)
    territory = next((t for t in territories if t.id == str(territory_id)), None)
    if territory is None:
        raise HTTPException(404, "Territory not found")

    # And then the raw entries, which `Territory.pincodes` has already thrown
    # away. Two reads answering two different questions: what routing SEES, and
    # what the customer TYPED. `invalid` is the difference between them. If the
    # row changes between the two — an admin editing the territory in another
    # tab — the worst outcome is one stale bucket on one render.
    entries = await pin_boundaries.claimed_entries(pool, org_id, str(territory_id))
    if entries is pin_boundaries.NO_SUCH_TERRITORY:
        # A sentinel and not `None`, because `None` is also what a territory
        # with no `pincodes` key at all reads as — fifteen of the eighteen live
        # ones. Those answer 200 with an empty FeatureCollection.
        raise HTTPException(404, "Territory not found")

    cover = await pin_boundaries.geometry_for_pins(entries)

    # `territory_name`, never the id: the id is already in the caller's URL, and
    # a name is what a screen draws.
    return {
        "type": "FeatureCollection",
        "features": cover.features,
        "territory_name": territory.name,
        "claimed": len(territory.pincodes),
        "matched": len(cover.features),
        "unmatched": cover.unmatched,
        "unavailable": cover.unavailable,
        "invalid": cover.invalid,
        "vintage": pin_boundaries.VINTAGE,
        "attribution": pin_boundaries.ATTRIBUTION,
    }


# ── Phase 3: Custom Fields ────────────────────────────────

class CustomFieldCreate(BaseModel):
    entity_type: str
    field_name: str
    field_type: str
    options: list = []
    is_required: bool = False
    sort_order: int = 0


@router.get("/custom-fields")
async def list_custom_fields(
    entity_type: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = "SELECT * FROM public.graha_custom_fields WHERE org_id=$1::uuid AND is_active=TRUE "
    params: list = [org_id]
    if entity_type:
        params.append(entity_type)
        q += f"AND entity_type=${len(params)} "
    q += "ORDER BY sort_order, field_name"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/custom-fields")
async def create_custom_field(
    body: CustomFieldCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    # Kept in step with the CHECK in
    # migration 131 and with CUSTOM_FIELD_ENTITIES
    # in CustomFieldInputs.jsx. Deliberately the same five names in all three:
    # until that migration is applied the database refuses the last three, and
    # matching lists mean the refusal is a clear 400 here rather than an
    # asyncpg CheckViolation surfacing as a 500.
    valid_entities = ("contact", "deal", "client", "activity", "follow_up")
    valid_types = ("text", "number", "date", "select", "checkbox", "url", "email", "phone")
    if body.entity_type not in valid_entities:
        raise HTTPException(400, f"entity_type must be one of: {', '.join(valid_entities)}")
    if body.field_type not in valid_types:
        raise HTTPException(400, f"field_type must be one of: {', '.join(valid_types)}")
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "INSERT INTO public.graha_custom_fields "
            "(org_id, entity_type, field_name, field_type, options, is_required, sort_order) "
            "VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id, field_name",
            org_id, body.entity_type, body.field_name, body.field_type,
            json.dumps(body.options), body.is_required, body.sort_order,
        )
    except asyncpg.exceptions.UniqueViolationError:
        raise HTTPException(409, "Field with this name already exists for this entity type")
    return {"status": "created", **dict(row)}


@router.delete("/custom-fields/{field_id}")
async def delete_custom_field(
    field_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    await pool.execute(
        "UPDATE public.graha_custom_fields SET is_active=FALSE "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(field_id), org_id,
    )
    return {"status": "deleted"}


# ── Phase 3: Web-to-Lead Forms ─────────────────────────────

class WebFormCreate(BaseModel):
    name: str
    slug: str
    fields: list = []
    settings: dict = {}
    auto_assign_to: str = ""
    auto_source: str = "web_form"


@router.get("/web-forms")
async def list_web_forms(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        # Aliased `w` only so the actor fragments have something to hang off —
        # the column list is otherwise unchanged. A web form is an org-admin
        # object that outlives the admin who made it, so "who published this
        # form?" is the question this list could never answer.
        "SELECT w.id, w.name, w.slug, w.fields, w.settings, w.auto_assign_to, w.auto_source, "
        "w.submission_count, w.is_active, "
        # `actor_select` is comma-TERMINATED, so it must be followed by another
        # column and never by the FROM — the two timestamps sit after it for
        # exactly that reason.
        + actor_select("w", updated=True) +
        "w.created_at, w.updated_at "
        "FROM public.graha_web_forms w "
        + actor_joins("w", updated=True) +
        "WHERE w.org_id=$1::uuid ORDER BY w.created_at DESC",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/web-forms")
async def create_web_form(
    body: WebFormCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    import re
    slug = re.sub(r"[^a-z0-9-]", "", body.slug.lower().strip())
    if not slug:
        raise HTTPException(400, "Invalid slug")
    try:
        row = await pool.fetchrow(
            # `$8` is `user["user_id"]` — a TEXT member id like
            # `user_f1a0a472b98f`. Until migration 202 this column was `uuid`,
            # so this bind could not have worked: every form creation would
            # have died in the parameter cast, which under PgBouncer surfaces
            # as an instant 500 with no useful message. 202 retyped the column
            # to TEXT to match `public.users.user_id` (the same type the other
            # 76 audit columns carry), and this INSERT became correct without
            # a line of it changing. Left as-is on purpose — the fix belonged
            # in the column, not here.
            "INSERT INTO public.graha_web_forms "
            "(org_id, name, slug, fields, settings, auto_assign_to, auto_source, created_by) "
            "VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, NULLIF($6::text,''), $7, $8) "
            "RETURNING id, name, slug",
            org_id, body.name, slug, json.dumps(body.fields),
            json.dumps(body.settings),
            body.auto_assign_to, body.auto_source, user["user_id"],
        )
    except asyncpg.exceptions.UniqueViolationError:
        raise HTTPException(409, "A form with this slug already exists")
    return {"status": "created", **dict(row)}


@router.delete("/web-forms/{form_id}")
async def delete_web_form(
    form_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if not await is_org_admin(user["user_id"], org_id):
        raise HTTPException(403, "This action requires an org owner or org admin")
    pool = await get_pool()
    await pool.execute(
        # `trg_touch_graha_web_forms` moves `updated_at` for this statement
        # whether or not it asks, so the actor MUST be written alongside it:
        # a stamp that advances while `updated_by` still names the previous
        # editor is an audit trail that points at the wrong person, which is
        # strictly worse than an empty one. `$3` is appended after the existing
        # binds so the WHERE clause keeps `$1`/`$2`.
        "UPDATE public.graha_web_forms SET is_active=FALSE, updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(form_id), org_id, user["user_id"],
    )
    return {"status": "deleted"}


@router.get("/web-forms/{form_id}/submissions")
async def list_form_submissions(
    form_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT s.id, s.data, s.contact_id, s.status, s.created_at, "
        "COUNT(*) OVER() AS _total "
        "FROM public.graha_web_form_submissions s "
        "JOIN public.graha_web_forms f ON f.id = s.form_id "
        "WHERE s.form_id=$1::uuid AND f.org_id=$2::uuid "
        "ORDER BY s.created_at DESC LIMIT 200",
        str(form_id), org_id,
    )
    # Inbound leads. A form that has taken more than 200 submissions shows the
    # newest 200 and gives no sign the rest exist — the one list where a missing
    # row is a lost customer rather than a stale figure.
    return _listed(rows, limit=200)


@router.get("/f/{slug}")
@limiter.limit("60/minute")
async def read_web_form(slug: str, request: Request):
    """The public face of a lead form — what a hosted page needs to draw it.

    ── WHY THIS ROUTE EXISTS AT ALL ────────────────────────────────────────
    `POST /f/{slug}` has always worked and there was nowhere to post FROM.
    `App.jsx` declares public routes for /login, /accept-invite, /approve,
    /sign/:token and /i/:token, and none for a lead form; the Web Forms tab
    offered no link, no preview and no hosted page, only a sentence telling
    the customer to POST JSON themselves. Suite 04.14 put it plainly: "a web
    form can be published and nobody can fill it in."

    ⚠ WHAT IT MAY ANSWER IS DELIBERATELY SHORTER THAN THE ROW.
    This is unauthenticated, so it returns the form's NAME and its field list
    and nothing else. Not `org_id`, not `submission_count`, not `created_by`,
    not `auto_assign_to` — a stranger holding a slug learns what to type in,
    which is the whole job, and learns nothing about the organisation behind
    it. `SELECT *` is what the POST below does and it is not what this does.

    A missing or retired form is 404, matching the POST, so an active slug and
    an inactive one are the same answer to someone guessing.
    """
    pool = await get_pool()
    form = await pool.fetchrow(
        "SELECT name, fields FROM public.graha_web_forms "
        "WHERE slug=$1 AND is_active=TRUE",
        slug,
    )
    if not form:
        raise HTTPException(404, "Form not found")
    return {"name": form["name"], "fields": form["fields"] or []}


@router.post("/f/{slug}")
@limiter.limit("10/minute")
async def submit_web_form(
    slug: str,
    request: Request,
):
    """
    ⚠ RATE-LIMITED, AND IT WAS NOT.

    This route is unauthenticated and it WRITES — a contact, a lead and a
    submission row into a paying customer's CRM — and it carried no limit of
    any kind. Anybody holding a slug could fill a customer's contact list at
    the speed of their connection, and the slug is by definition public.
    CLAUDE.md's rule names "anything auth-shaped"; an unauthenticated public
    write is the same hazard wearing different clothes.

    10/minute per caller: a person filling in a form once is nowhere near it,
    and a script is stopped. The key is the last forwarded hop before the
    Cloudflare edge — see `limiter.py`, which is the only correct reading of
    `X-Forwarded-For` behind two proxies.
    """
    pool = await get_pool()
    form = await pool.fetchrow(
        "SELECT * FROM public.graha_web_forms WHERE slug=$1 AND is_active=TRUE",
        slug,
    )
    if not form:
        raise HTTPException(404, "Form not found")

    payload = await request.json()
    org_id = str(form["org_id"])
    form_id = str(form["id"])

    name = str(payload.get("name", ""))[:200]
    email = str(payload.get("email", ""))[:200]
    phone = str(payload.get("phone", ""))[:20]
    company = str(payload.get("company", ""))[:200]

    existing = None
    if email:
        existing = await pool.fetchrow(
            "SELECT id FROM public.graha_contacts WHERE org_id=$1::uuid AND email=$2",
            org_id, email,
        )
    if not existing and phone:
        existing = await pool.fetchrow(
            "SELECT id FROM public.graha_contacts WHERE org_id=$1::uuid AND phone=$2",
            org_id, phone,
        )

    contact_id = None
    if existing:
        contact_id = str(existing["id"])
    elif name:
        # `xmax = 0` IS HOW AN UPSERT TELLS YOU WHICH HALF RAN.
        #
        # This statement is `ON CONFLICT ... DO UPDATE`, so a repeat submission
        # from the same phone number returns the EXISTING contact's id and
        # touches nothing. Emitting on that id would announce a lead created
        # that was not — and on a PUBLIC form, which anyone can submit twice, a
        # rule on "a lead is added" would fire again for every resubmission.
        #
        # Postgres sets `xmax` to 0 on a row this statement INSERTED and to the
        # locking transaction id on one it UPDATED. It is the only signal the
        # statement carries; the returned row is otherwise identical.
        #
        # VERIFIED, not assumed — it rests on an implementation detail rather
        # than a documented guarantee, and reading `xmax` on ordinary rows gives
        # a mix of both values, which is exactly the sort of thing that reads as
        # confirmation if you squint. Run against this database's own Postgres
        # on a TEMP table inside a rolled-back transaction: first submission
        # `_inserted = True`, second `_inserted = False`.
        # ── `client_id`: FROM THE FORM'S OWN CONFIG, NEVER FROM THE PAYLOAD ──
        # Written explicitly, for the same reason `auto_assign_to` is: a
        # contact born with a NULL `client_id` is permanently unemailable —
        # Prachar's audience resolver gates every send on `client_id IS NOT
        # NULL` under the ICAI bar on soliciting non-clients.
        #
        # THE PAYLOAD IS NOT CONSULTED, and that is the whole point. This
        # endpoint is public and unauthenticated; a `client_id` accepted from
        # the submitted JSON would let anyone on the internet declare
        # themselves a client of the firm and walk straight through the gate.
        # The company can only be the one the org configured on the form —
        # a form embedded on one client's own page — and it is still checked
        # against the form's org before it is written.
        _settings = form["settings"] or {}
        if isinstance(_settings, str):
            _settings = json.loads(_settings or "{}")
        # `strict=False`: the visitor filling this in is not the partner who
        # configured it, and a company archived since the form went live must
        # cost the firm a link, never the lead. See the helper.
        form_client_id = await resolve_contact_company(
            pool, org_id, str(_settings.get("client_id") or ""), strict=False)

        from services.niyam.subjects import contact_created
        async with pool.acquire() as _conn:
            async with _conn.transaction():
                contact_row = await _conn.fetchrow(
                    "INSERT INTO public.graha_contacts "
                    "(org_id, name, email, phone, company, contact_type, source, "
                    " assigned_to, notes, created_by, client_id) "
                    "VALUES ($1::uuid, $2, $3, $4, $5, 'lead', $6, "
                    " NULLIF($7,'')::uuid, $8, 'system', NULLIF($9,'')::uuid) "
                    "ON CONFLICT (org_id, phone) WHERE phone IS NOT NULL AND phone != '' "
                    # `DO UPDATE SET notes = <its own notes>` is a deliberate
                    # no-op: a resubmission must return the existing row's id
                    # and change NOTHING. `client_id` is not in the SET list,
                    # so a repeat submission cannot re-point — or unlink — the
                    # company an existing contact already belongs to.
                    "DO UPDATE SET notes = public.graha_contacts.notes "
                    "RETURNING *, (xmax = 0) AS _inserted",
                    org_id, name, email, phone, company,
                    form["auto_source"] or "web_form",
                    str(form["auto_assign_to"]) if form["auto_assign_to"] else "",
                    str(payload.get("message", ""))[:2000],
                    form_client_id,
                )
                if contact_row["_inserted"]:
                    await contact_created(_conn, org_id=org_id, actor_id=None,
                                          contact_id=contact_row["id"],
                                          row=dict(contact_row), source="import")
        contact_id = str(contact_row["id"])


    sub = await pool.fetchrow(
        "INSERT INTO public.graha_web_form_submissions "
        "(org_id, form_id, data, contact_id, ip_address, status) "
        "VALUES ($1::uuid, $2::uuid, $3::jsonb, NULLIF($4,'')::uuid, $5, 'processed') "
        "RETURNING id",
        org_id, form_id, json.dumps(payload, default=str),
        contact_id or "", request.client.host if request.client else "",
    )

    await pool.execute(
        # NO `updated_by` here, and it is not an oversight. This route is
        # unauthenticated by design — it is the public form endpoint — so
        # there is no member to name, and the only two alternatives are both
        # wrong: writing NULL would ERASE the admin who last edited the form
        # every time a stranger submitted it, and inventing a system id would
        # put a value in the column that no user page can resolve. The counter
        # is not an edit anyone made to the form's definition, so the form's
        # last editor stays whoever it was. `trg_touch_graha_web_forms` still
        # advances `updated_at`, which is honest: the row did change.
        "UPDATE public.graha_web_forms SET submission_count=submission_count+1 "
        "WHERE id=$1::uuid",
        form_id,
    )

    return {"status": "submitted", "id": str(sub["id"])}


# ── Approval Chains ─────────────────────────────────────────

class ApprovalRuleCreate(BaseModel):
    entity_type: str
    threshold_amount: float = 0
    approver_role: str = ""


class ApprovalRuleUpdate(BaseModel):
    threshold_amount: float | None = None
    approver_role: str | None = None


@router.get("/approval-rules")
async def list_approval_rules(
    entity_type: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # `r.*` rather than the bare `*` this had: once `public.users` is joined
    # twice, an unqualified star would drag both user rows into the result and
    # collide on `name`, `created_at` and `user_id`. The alias keeps the
    # response shape exactly what it was, plus the four actor columns.
    #
    # An approval rule decides whose signature a deal needs, so "who set this
    # threshold?" is a governance question, not a nicety — and migration 202
    # is what made it answerable by giving this table `created_by` at all.
    # The actor columns lead and `r.*` closes the list: `actor_select` is
    # comma-TERMINATED, so putting it last would butt a comma straight against
    # the FROM. Ordering inside a SELECT list has no meaning to a JSON
    # response, so this costs nothing.
    q = ("SELECT "
         + actor_select("r", updated=True)
         + "r.* "
         "FROM public.graha_approval_rules r "
         + actor_joins("r", updated=True)
         + "WHERE r.org_id=$1::uuid AND r.is_active=TRUE")
    params: list = [org_id]
    if entity_type:
        params.append(entity_type)
        q += f" AND r.entity_type=${len(params)}"
    q += " ORDER BY r.threshold_amount ASC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/approval-rules")
async def create_approval_rule(
    body: ApprovalRuleCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    valid_types = ("deal", "vendor_bill", "expense_claim")
    if body.entity_type not in valid_types:
        raise HTTPException(400, f"entity_type must be one of: {', '.join(valid_types)}")
    row = await pool.fetchrow(
        # `created_by` is new here — migration 202 added the column, and this
        # INSERT is the only place a rule is ever born, so without this bind
        # the column would be NULL for every rule the product creates and the
        # list endpoint above would resolve a name for nobody. The value is the
        # TEXT member id, matching `public.users.user_id`; there is no uuid
        # cast because 202 typed the column TEXT deliberately (the same lesson
        # `graha_web_forms.created_by` cost).
        "INSERT INTO public.graha_approval_rules "
        "(org_id, entity_type, threshold_amount, approver_role, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5) RETURNING *",
        org_id, body.entity_type, body.threshold_amount, body.approver_role,
        user["user_id"],
    )
    return dict(row)


@router.patch("/approval-rules/{rule_id}")
async def update_approval_rule(
    rule_id: str,
    body: ApprovalRuleUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    if body.threshold_amount is not None:
        vals.append(body.threshold_amount); updates.append(f"threshold_amount=${len(vals)}")
    if body.approver_role is not None:
        vals.append(body.approver_role); updates.append(f"approver_role=${len(vals)}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    # Appended BEFORE the two WHERE binds, because those are addressed as
    # `len(vals)-1` and `len(vals)` — anything pushed after them would silently
    # renumber the id and the org and the statement would filter on the actor
    # id instead. `updated_at` is not set here and does not need to be:
    # `trg_touch_graha_approval_rules` moves it, which is precisely why the
    # actor cannot be left out — the stamp advances either way, and only this
    # statement knows whose change it was.
    vals.append(user["user_id"]); updates.append(f"updated_by=${len(vals)}")
    vals += [rule_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE public.graha_approval_rules SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid AND is_active=TRUE RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Approval rule not found")
    return dict(row)


@router.delete("/approval-rules/{rule_id}")
async def delete_approval_rule(
    rule_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        # Retiring a rule changes who has to approve a deal from that moment
        # on. That is the single most consequential write on this table and it
        # recorded no author at all.
        "UPDATE public.graha_approval_rules SET is_active=FALSE, updated_at=NOW(), "
        "updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        rule_id, org_id, user["user_id"],
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Approval rule not found")
    return {"ok": True}


@router.get("/approval-requests")
async def list_approval_requests(
    status: str = "",
    entity_type: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # THIS TABLE ALREADY HAD ITS ACTORS AND WAS RENDERING THEM AS IDS.
    #
    # `graha_approval_requests` records `requested_by` and `approved_by`, so
    # migrations 201/202 gave it nothing — it was never missing an author.
    # What it was missing is the RESOLUTION: this query sent `ar.*`, and
    # `ApprovalsTab.jsx` printed `r.requested_by?.slice(0, 12)` — a truncated
    # `users.user_id` on screen, which is the names-not-ids rule broken, and
    # `approved_by` was not shown at all. The ratchet
    # (`check-rendered-ids.mjs`) is positional and a 12-character slice of
    # `user_f1a0a472b98f` does not read as an id shape, so nothing caught it.
    #
    # `actor_select`/`actor_joins` cannot be used here: they resolve columns
    # NAMED `created_by`/`updated_by`. The ladder is the same one, written out
    # against this table's own column names, and it stops at names — no email
    # rung, for the reason `list_activities` above no longer has one.
    #
    # Aliased `created_by_name`/`has_creator` so the frontend contract is
    # identical to every other table's; the approver keeps its own name because
    # "approved by" is a different fact from "last edited by" and must not be
    # read as one.
    q = (
        "SELECT ar.*, ru.threshold_amount, ru.approver_role, "
        "COALESCE(NULLIF(btrim(_rq.name), ''), NULLIF(btrim(_rq.full_name), '')) "
        "  AS created_by_name, "
        "(ar.requested_by IS NOT NULL) AS has_creator, "
        "COALESCE(NULLIF(btrim(_ap.name), ''), NULLIF(btrim(_ap.full_name), '')) "
        "  AS approved_by_name, "
        "(ar.approved_by IS NOT NULL) AS has_approver, "
        "COUNT(*) OVER() AS _total "
        "FROM public.graha_approval_requests ar "
        "JOIN public.graha_approval_rules ru ON ru.id = ar.rule_id "
        "LEFT JOIN public.users _rq ON _rq.user_id = ar.requested_by "
        "LEFT JOIN public.users _ap ON _ap.user_id = ar.approved_by "
        "WHERE ar.org_id=$1::uuid"
    )
    params: list = [org_id]
    if status:
        params.append(status)
        q += f" AND ar.status=${len(params)}"
    if entity_type:
        params.append(entity_type)
        q += f" AND ar.entity_type=${len(params)}"
    q += " ORDER BY ar.created_at DESC LIMIT 200"
    rows = await pool.fetch(q, *params)
    return _listed(rows, limit=200)


@router.post("/approval-requests/{req_id}/approve")
async def approve_request(
    req_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE public.graha_approval_requests "
        "SET status='approved', approved_by=$1, decided_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid AND status='pending' RETURNING *",
        user["user_id"], req_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Approval request not found or already processed")
    return dict(row)


@router.post("/approval-requests/{req_id}/reject")
async def reject_request(
    req_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE public.graha_approval_requests "
        "SET status='rejected', approved_by=$1, decided_at=NOW() "
        "WHERE id=$2::uuid AND org_id=$3::uuid AND status='pending' RETURNING *",
        user["user_id"], req_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Approval request not found or already processed")
    return dict(row)


# ── Document Repository ────────────────────────────────────

class DocumentCreate(BaseModel):
    name: str
    file_url: str
    file_key: str = ""
    file_size: int = 0
    mime_type: str = ""
    folder: str = ""
    tags: list[str] = []
    contact_id: str = ""
    deal_id: str = ""
    description: str = ""


class DocumentUpdate(BaseModel):
    name: str | None = None
    folder: str | None = None
    tags: list[str] | None = None
    description: str | None = None
    contact_id: str | None = None
    deal_id: str | None = None


@router.get("/documents")
async def list_documents(
    folder: str = "",
    contact_id: str = "",
    deal_id: str = "",
    search: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # ── THE CREATOR IS CALLED `uploaded_by` ON THIS TABLE ──────────────────
    # `graha_documents` predates the audit-column migrations and named its
    # author column `uploaded_by` — which is the same fact as `created_by`
    # everywhere else in this file, holding the same `public.users.user_id`
    # TEXT. Migration 201 therefore did NOT give it a `created_by`; renaming
    # the existing column would have been the tidier answer and was rejected,
    # because `upload_document` and `create_document` both write it by name and
    # a rename is a deploy-ordering trap: the old code writes to a column that
    # no longer exists for as long as the two are out of step.
    #
    # So the creator half is hand-written here against `uploaded_by`, using the
    # SAME ladder as `services/audit_actors` and emitting the SAME two output
    # names (`created_by_name`, `has_creator`). The frontend contract is
    # identical to every other list — a document is not a special case on
    # screen, only in this one column name. `actor_select`/`actor_joins` are
    # still used for the updater half, which is an ordinary `updated_by`.
    #
    # `d.*` and not `*`: with `public.users` joined twice, a bare star would
    # pour both user rows into the result — every document would carry the
    # uploader's EMAIL, which is the exact leak this whole exercise exists to
    # close, arriving through the back door. Every filter below is qualified
    # for the same reason: unqualified `name` and `created_at` become ambiguous
    # the moment `users` is in the FROM list, and Postgres answers that with an
    # error rather than a guess.
    q = ("SELECT d.*, "
         "COALESCE(NULLIF(btrim(_cu.name), ''), NULLIF(btrim(_cu.full_name), '')) "
         "AS created_by_name, "
         # The client NAME for `d.folder`, by the same rule `/documents/folders`
         # uses — see the long note there. `d.folder` is a storage key holding a
         # client UUID, and the Folder column rendered it raw; Suite 20.03 found
         # three UUIDs on this screen on 2026-08-30 and this is one of the two
         # places they came from. The raw `folder` stays in the payload because
         # the filter round-trips on that exact string.
         "COALESCE(NULLIF(btrim(_fc.name), ''), "
         "         CASE WHEN d.folder = 'crm/unfiled/documents' THEN 'Unfiled' END, "
         "         d.folder) AS folder_label, "
         "(d.uploaded_by IS NOT NULL) AS has_creator, "
         + actor_select("d", created=False, updated=True) +
         "COUNT(*) OVER() AS _total "
         "FROM public.graha_documents d "
         # Cast only where the shape matches, so a non-client folder is NULL
         # rather than a failed cast on every row of the list.
         "LEFT JOIN public.graha_clients _fc "
         "  ON _fc.org_id = d.org_id "
         " AND _fc.id = substring(d.folder from '^crm/([0-9a-fA-F-]{36})/')::uuid "
         # `_cu` is `audit_actors.CREATOR_ALIAS` by hand — the same alias the
         # generated half would have used, so the two never collide and a
         # reader sees one convention. `public.` is spelled out: migration 142
         # exists because a query trusted `search_path` and found a shadow
         # table in the other schema.
         "LEFT JOIN public.users _cu ON _cu.user_id = d.uploaded_by "
         + actor_joins("d", created=False, updated=True) +
         "WHERE d.org_id=$1::uuid AND d.is_active=TRUE")
    params: list = [org_id]
    if folder:
        params.append(folder)
        q += f" AND d.folder=${len(params)}"
    if contact_id:
        params.append(contact_id)
        q += f" AND d.contact_id=${len(params)}::uuid"
    if deal_id:
        params.append(deal_id)
        q += f" AND d.deal_id=${len(params)}::uuid"
    if search:
        params.append(f"%{search}%")
        q += f" AND (d.name ILIKE ${len(params)} OR d.description ILIKE ${len(params)})"
    q += " ORDER BY d.created_at DESC LIMIT 200"
    rows = await pool.fetch(q, *params)
    from services.storage import sign_key
    # Post-processes each row to mint a signed file URL, so it cannot hand
    # `rows` straight to `_listed` — same shape as `ganit.list_contracts`. The
    # envelope is assembled from the same `_total` window column, popped inside
    # the loop so it cannot ride out on a document the frontend maps over.
    total = int(dict(rows[0]).get("_total", len(rows))) if rows else 0
    docs = []
    for r in rows:
        d = dict(r)
        d.pop("_total", None)
        if d.get("file_key"):
            d["file_url"] = await sign_key(org_id, d["file_key"]) or d.get("file_url", "")
        docs.append(d)
    return {"data": docs, "total": total, "limit": 200, "truncated": total > 200}


#: The document size ceiling the CRM advertises and enforces. It is
#: `uploads.MAX_BYTES` — imported, never restated, because a limit written twice
#: is a limit that will disagree with itself. Video is the one exception the
#: upload service makes, and it does not apply here: a CRM document is a
#: contract or a proposal, and 25 MB of video filed against a client is a
#: mistake rather than a document.
from routers.uploads import MAX_BYTES as DOCUMENT_MAX_BYTES  # noqa: E402


@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    name: str = Form(""),
    client_id: str = Form(""),
    contact_id: str = Form(""),
    deal_id: str = Form(""),
    description: str = Form(""),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Upload a CRM document. The user gives a file, a name and a client.

    The old flow asked for a **file URL**, typed by hand, and a **folder**, also
    typed by hand. Neither is something a user can be expected to know: the URL
    only exists once the file has been uploaded somewhere, and nothing in the
    product uploaded it. So the tab could only file links to documents that
    lived elsewhere, which is not what "Documents" means.

    The key is built here and never asked for:

        crm/<client_id>/documents/<file>

    keyed on the client's ID rather than its name, because a client can be
    renamed and every object already written under the old name would be
    orphaned. `folder` carries the same path so the existing folder filter and
    the `/documents/folders` rollup keep working with no change.

    Without a client the path is `crm/unfiled/documents/` — deliberately a real
    place rather than a refusal. Documents arrive before anyone has decided who
    they belong to, and forcing the decision at upload time is how they end up
    filed against the wrong client.
    """
    from services.storage import read_capped, upload_file

    # Read with the cap applied AS IT READS, not after: the alternative is
    # buffering an arbitrarily large body and then declining it.
    content = await read_capped(file, DOCUMENT_MAX_BYTES)
    size = len(content)
    if not size:
        raise HTTPException(400, "That file is empty.")

    if client_id:
        owned = await pool_client_check(client_id, org_id)
        if not owned:
            raise HTTPException(404, "Client not found")

    # ── TWO DIFFERENT "FOLDERS", AND THEY WERE THE SAME STRING ──────────────
    #
    # `folder` below is a COLUMN on `staging.graha_documents`. The documents
    # list filters on it (`AND folder=$n`) and the `/documents/folders` rollup
    # groups by it, so it is a fact about the record and it keeps exactly the
    # value it has always had — including `crm/unfiled/documents`, which the
    # docstring above argues for and which is still right: a document arrives
    # before anyone has decided whose it is, and forcing that decision at upload
    # time is how documents end up filed against the wrong client.
    #
    # The OBJECT KEY is a different question, and it used to be answered with
    # this same string. It is now the grammar (proposal 83 §4):
    # `crm/{client_id}/{user_id}/YYYY/MM/{id}--gst-certificate.pdf`. Three
    # things follow from that:
    #
    #   · THE UPLOADER IS RECORDED ON THE FILE. The old key named the client and
    #     not the person, so "who filed this" was answerable only from the
    #     database.
    #   · THE ORIGINAL FILENAME SURVIVES — §3's fourth complaint, the key having
    #     been a bare uuid.
    #   · A DOCUMENT WITH NO CLIENT is stored under its uploader rather than
    #     pooled in a shared `unfiled` prefix. §3 calls that pool "a bucket of
    #     last resort that nothing ever revisits"; the COLUMN still says
    #     unfiled, so nothing on any screen changes.
    folder = f"crm/{client_id or 'unfiled'}/documents"
    try:
        stored = await upload_file(
            file_bytes=content,
            filename=file.filename or "document",
            content_type=file.content_type or "application/octet-stream",
            user_id=user["user_id"],
            module="crm",
            scope=[client_id],
            org_id=org_id,
        )
    except HTTPException:
        raise
    except Exception:
        log.exception("CRM document upload failed: size=%d client=%s", size, client_id)
        raise HTTPException(503, "Upload service temporarily unavailable — please try again in a moment.")

    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO public.graha_documents "
        "(org_id, name, file_url, file_key, file_size, mime_type, folder, tags, "
        "contact_id, deal_id, description, uploaded_by) "
        # `$8::text::jsonb` for the same reason as `create_document` below —
        # the jsonb codec dumps a second time and the column ends up holding a
        # JSON string rather than an array.
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::text::jsonb, "
        "NULLIF($9,'')::uuid, NULLIF($10,'')::uuid, $11, $12) RETURNING *",
        org_id,
        name.strip() or (file.filename or "document"),
        stored.get("url", ""), stored.get("key", ""), size,
        stored.get("content_type") or file.content_type or "",
        folder, json.dumps([]),
        contact_id, deal_id, description, user["user_id"],
    )
    return {"status": "created", **dict(row)}


async def pool_client_check(client_id: str, org_id: str) -> bool:
    """A client id belongs to this org. Its own function because the upload
    route is not the last thing that will need to ask."""
    pool = await get_pool()
    return bool(await pool.fetchval(
        "SELECT 1 FROM public.graha_clients "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        client_id, org_id,
    ))


@router.post("/documents")
async def create_document(
    body: DocumentCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    # `/documents/upload` above stores the file and mints its own URL. This
    # route takes both as strings the caller chose, so it is the one a `data:`
    # URI can be posted through with R2 healthy — which is what put 99MB of
    # files inside the database. Refused before the pool is touched.
    assert_file_url(body.file_url, "file_url")
    assert_file_url(body.file_key, "file_key")

    pool = await get_pool()
    # BOTH PARENTS PROVEN TO BE THIS ORG'S. The same two unscoped foreign keys
    # again, and here the thing being filed into another tenant's record is a
    # FILE — it lands in their documents tab under their contact, with a
    # `file_url` this caller chose and controls.
    contact_id = await resolve_deal_contact(pool, org_id, body.contact_id)
    deal_id = await resolve_deal_id(pool, org_id, body.deal_id)
    row = await pool.fetchrow(
        "INSERT INTO public.graha_documents "
        "(org_id, name, file_url, file_key, file_size, mime_type, folder, tags, "
        "contact_id, deal_id, description, uploaded_by) "
        # `$8::text::jsonb`, NOT `$8::jsonb`. `db.py` registers a jsonb codec
        # whose encoder IS `json.dumps`, so binding an already-dumped string to
        # a jsonb parameter dumps it twice and the column ends up holding a JSON
        # *string* rather than an array.
        #
        # That crashed this tab. `tags` came back as the STRING "[]", and
        # `DocumentsTab.jsx`'s `d.tags?.length > 0` guard passes for a string —
        # `"[]".length` is 2 — so `d.tags.map(...)` threw
        # `TypeError: r.tags.map is not a function` and the error boundary took
        # the whole Graha page down for ANY org holding a document.
        #
        # Contacts and deals were never affected: `graha_contacts.tags` is
        # `TEXT[]` and they bind `body.tags` directly.
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::text::jsonb, "
        "NULLIF($9,'')::uuid, NULLIF($10,'')::uuid, $11, $12) RETURNING *",
        org_id, body.name, body.file_url, body.file_key, body.file_size, body.mime_type,
        body.folder, json.dumps(body.tags),
        contact_id, deal_id, body.description, user["user_id"],
    )
    return dict(row)


@router.get("/documents/folders")
async def list_document_folders(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        # ── A FOLDER PATH IS A STORAGE KEY, AND IT CONTAINS A UUID ──────────
        #
        # `folder` is `crm/<graha_clients.id>/documents` — the key the file
        # actually lives under in R2. The filter needs that exact string
        # (`AND d.folder=$n`), so it keeps being returned. What must NEVER be
        # returned alone is the path itself for DISPLAY: the product's standing
        # rule is that no UUID is ever rendered, and Suite 20.03 caught three of
        # them on this screen on 2026-08-30, in the folder picker and the
        # folder column — "crm/19df5798-a669-…/documents (1)".
        #
        # `folder_label` is that same row's client NAME. Computed here rather
        # than in the client so the picker and the table column cannot disagree
        # about what one folder is called, and so a third reader gets it right
        # for free.
        #
        # The id is extracted by regex and cast only when the shape matches, so
        # a folder that is not a client path (`crm/unfiled/documents`, or
        # anything a later feature invents) yields NULL rather than raising on
        # the cast. `COALESCE` then falls back to 'Unfiled', and finally to the
        # raw folder — which keeps a NEW path shape visible and reportable
        # instead of blank, and lets 20.03 catch it rather than this hiding it.
        "WITH f AS ("
        "  SELECT folder, COUNT(*) AS count,"
        "         substring(folder from '^crm/([0-9a-fA-F-]{36})/') AS _cid"
        "    FROM public.graha_documents"
        "   WHERE org_id=$1::uuid AND is_active=TRUE AND folder != ''"
        "   GROUP BY folder"
        ") "
        "SELECT f.folder, f.count, "
        "       COALESCE(NULLIF(btrim(c.name), ''), "
        "                CASE WHEN f.folder = 'crm/unfiled/documents' THEN 'Unfiled' END, "
        "                f.folder) AS folder_label "
        "  FROM f "
        "  LEFT JOIN public.graha_clients c "
        "    ON c.id = f._cid::uuid AND c.org_id = $1::uuid "
        " ORDER BY folder_label",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/documents/{doc_id}")
async def get_document(
    doc_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT d.*, c.name AS contact_name "
        "FROM public.graha_documents d "
        "LEFT JOIN public.graha_contacts c ON c.id = d.contact_id "
        "WHERE d.id=$1::uuid AND d.org_id=$2::uuid AND d.is_active=TRUE",
        doc_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Document not found")
    return dict(row)


@router.patch("/documents/{doc_id}")
async def update_document(
    doc_id: str,
    body: DocumentUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = [], []
    for field in ("name", "folder", "description"):
        v = getattr(body, field)
        if v is not None:
            vals.append(v); updates.append(f"{field}=${len(vals)}")
    if body.tags is not None:
        # `::text::jsonb` — see the INSERT above. Binding a dumped string to a
        # jsonb parameter double-encodes it, because db.py's jsonb encoder is
        # itself `json.dumps`.
        vals.append(json.dumps(body.tags)); updates.append(f"tags=${len(vals)}::text::jsonb")
    # RE-FILING IS THE SAME WRITE AS FILING. A document created correctly inside
    # this org can be PATCHed onto another organisation's contact or deal, which
    # is the identical leak the create path had one route up — and easier,
    # because the row already exists and only the parent id has to be guessed.
    # `""` still clears, because each resolver returns "" unchanged.
    if body.contact_id is not None:
        v = await resolve_deal_contact(pool, org_id, body.contact_id)
        vals.append(v); updates.append(f"contact_id=NULLIF(${len(vals)},'')::uuid")
    if body.deal_id is not None:
        v = await resolve_deal_id(pool, org_id, body.deal_id)
        vals.append(v); updates.append(f"deal_id=NULLIF(${len(vals)},'')::uuid")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    # BEFORE `vals += [doc_id, org_id]`, because the WHERE clause addresses
    # those two as `len(vals)-1` and `len(vals)`; appending after them would
    # renumber the id and the org and this statement would go looking for a
    # document whose id is a member id. `uploaded_by` is left alone — the
    # person who filed the document is not the person who renamed it, and
    # overwriting the one with the other is how a table ends up with a single
    # actor column pretending to be two.
    vals.append(user["user_id"]); updates.append(f"updated_by=${len(vals)}")
    vals += [doc_id, org_id]
    row = await pool.fetchrow(
        f"UPDATE public.graha_documents SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid AND is_active=TRUE RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Document not found")
    return dict(row)


@router.delete("/documents/{doc_id}")
async def delete_document(
    doc_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()

    # ── READ IT BEFORE DEACTIVATING IT, so the bin row can carry the key ────
    # `is_active=FALSE` alone made the document invisible and left the R2 object
    # in the bucket with nothing listing it — not orphaned in the strict sense,
    # since the row kept the key, but unreachable through any screen and
    # unrecoverable by the customer. Proposal 93 §B, migration 239: it goes to
    # the org's recycle bin instead, restorable for 14 days, in the
    # second-stage bin to 90.
    doc = await pool.fetchrow(
        "SELECT id, name, file_key, file_url, file_size FROM public.graha_documents "
        "WHERE id=$1::uuid AND org_id=$2::uuid AND is_active=TRUE",
        doc_id, org_id,
    )
    if not doc:
        raise HTTPException(404, "Document not found")

    try:
        await bin_svc.bin_file(
            org_id=org_id,
            source_kind="graha_document",
            source_id=str(doc["id"]),
            file_name=doc["name"] or "document",
            r2_key=doc["file_key"] or "",
            file_url=doc["file_url"],
            size_bytes=doc["file_size"] or 0,
            deleted_by=user["user_id"],
        )
    except Exception as exc:  # noqa: BLE001
        # Refuse the delete rather than deactivate a document the bin does not
        # know about. A bin that fails open tells the customer a file is
        # recoverable when it is not, which is worse than not offering to
        # recover it at all.
        log.error("recycle_bin: refusing to remove document %s — %s", doc_id, exc)
        raise HTTPException(
            500,
            "That document could not be moved to the recycle bin, so it has not "
            "been removed. Please try again.",
        )

    result = await pool.execute(
        # A CRM document is a contract or a proposal; "who removed it?" is the
        # question an argument turns on later, and the soft delete leaves no
        # other trace of the act.
        "UPDATE public.graha_documents SET is_active=FALSE, updated_at=NOW(), "
        "updated_by=$3 "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        doc_id, org_id, user["user_id"],
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Document not found")
    return {"ok": True, "recycle_bin": True}
