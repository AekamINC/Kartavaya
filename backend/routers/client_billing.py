"""
client_billing.py — Client Billing Profiles, Service Lines, Metered Usage,
and Auto-Invoice.

Proposal 87, phases P5.1 + P5.2 + P5.3.  Lives in its own router rather than
inside ganit.py (3,500 lines already).  Gate: any of ganit / graha / vikray —
a firm that holds any of those can manage its client billing.
"""
import json
import logging
from datetime import date
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator


class _NullMeansUnset(BaseModel):
    """`null` for an optional field means "not provided", not "type error".

    ── WHY THIS EXISTS ────────────────────────────────────────────────────────

    Every create form on these screens sends `field: form.field || null`, which
    is the ordinary JavaScript spelling of "the box is empty". The create models
    give those fields a plain default — `notes: str = ""`, `rate: float = 0` —
    and Pydantic refuses `None` against `str`. So an empty box is a **422**,
    and the screen shows only "Failed to save".

    ⚠ **`POST /v1/ganit/billing/rate-cards` refused EVERY rate card that had no
    note.** Found by proposal 93 Suite 05 on 2026-08-29 — rate cards stood at
    **0 of 3** while every other Ganit volume filled, and the person typing had
    no way to learn that the empty Notes box was the cause.

    It is not one field. Across the four create/update pairs in this file
    **eighteen** fields are nullable on update and not on create — `notes`,
    `item_category`, `rate`, `unit`, `proration_clause`, `metric`, `quantity`,
    `description`, `amount`, `auto_invoice`, `billing_cycle`, `anchor_day`,
    `payment_terms_days`, `currency`, `gst_treatment`. Blank accepted when you
    EDIT a row and refused when you CREATE one is not a rule anybody could
    guess, and widening eighteen annotations by hand leaves the nineteenth.

    ── WHAT IT DOES ───────────────────────────────────────────────────────────

    Drops `None` values before validation for any field that HAS a default, so
    the default applies exactly as if the key had been omitted. A field with no
    default — `vendor_id`, `period`, `client_id` — is untouched and still
    required, because "not provided" is genuinely an error there and silently
    inventing a value would be worse than the 422.

    A field annotated `X | None` is also untouched: `None` is a legal value it
    was given on purpose, and coercing it to the default would erase a
    deliberate clear.
    """

    @model_validator(mode="before")
    @classmethod
    def _drop_nulls_that_have_defaults(cls, data):
        if not isinstance(data, dict):
            return data
        out = None
        for name, field in cls.model_fields.items():
            if data.get(name, ...) is not None:
                continue
            if field.is_required():
                continue  # no default to fall back on — a real 422
            if type(None) in getattr(field.annotation, "__args__", ()):
                continue  # `X | None`: None is a value, not an absence
            if out is None:
                out = dict(data)
            out.pop(name, None)
        return out if out is not None else data

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_any_module
from services.billing_cycle import next_anchor, period_end_for
# THE state codelist, not a second copy. `_norm_state` collapses '27', 'MH' and
# 'Maharashtra' onto one canonical two-digit code — the same helper
# `routers/vetana.py`, `routers/manav.py` and `attendance_auto_mark.py` import,
# for the same reason: a second copy is a second thing to drift.
from services.gst_states import GST_STATES as _GST_STATES, norm_state as _norm_state
from utils import next_doc_number


#: `line_items[].cost_basis` — why the lines this file writes carry no cost.
#:
#: Migration 184 made `line_items[].cost_price` the line's own memory of what
#: it cost, and `vikray.apply_line_costs` the one place it is written. That
#: helper is deliberately NOT called here, and the absence has to be stated
#: out loud because the ratchets that would otherwise state it — the two AST
#: checks in `tests/test_line_cost_snapshot.py` — parse ganit and vikray by
#: name and cannot see this module.
#:
#: There is nothing here for it to resolve. It costs a line from
#: `line_items[].product_id` against `staging.ganit_products`, and neither
#: table these two paths read from has a product at all: `client_service_lines`
#: is (kind, description, amount, cadence) and `client_metered_usage` is
#: (metric, quantity, unit, rate) — read off the live catalogue 2026-08-26.
#: Calling it would pop a key nobody set, skip its query and hand back the
#: same lines, while telling the next reader that a lookup happens here and
#: that an absent cost means the product had none recorded. There is no
#: product, and that misreading is one step from someone joining
#: `ganit_products` at read time — the very join `cost_price` exists to avoid.
#:
#: A zero is worse than silence: what a retainer or a metered GB costs this
#: firm is staff time, which nothing in this product records, so it would
#: report every rupee of service revenue as pure profit. That is 184's ABSENT,
#: NEVER ZERO rule, which the margin readers already honour by guarding on
#: `li ? 'cost_price'` rather than coalescing.
#:
#: So the cost stays absent and the LINE SAYS WHY — 1.3's own ratchet calls
#: out a document nothing can compute a margin from with nothing saying so.
#: Additive and invisible: every existing reader filters on `cost_price`, and
#: `pay.py:_line` rebuilds the customer's line from a closed allow-list, so
#: this never leaves the firm. `tests/test_billing_line_cost_basis.py` holds
#: all of it, including the two INSERTs below being the only ones.
NO_COST_BASIS = "none_service_revenue"


async def _tax_invoice_prefix(pool, org_id: str) -> str:
    """The serial prefix THIS firm numbers a tax invoice with.

    ── WHY THIS IS A DELEGATION AND NOT A VALUE ──────────────────────────────

    `ganit.py` resolves the prefix per organisation from
    `organisations.settings->'doc_prefixes'` (`_doc_prefix`), which is why
    every invoice Unicode Group has raised by hand is `UNX-2026-nnnn` — read
    live 2026-08-29, `{"tax_invoice": "UNX", "purchase_order": "KRY"}` across
    53 invoices. Both invoice writers in THIS file hardcoded `"INV"`.

    That is not merely a cosmetic mismatch. `next_doc_number` takes the last
    serial for the org **whatever its prefix** and adds one, so the two writers
    shared one counter while disagreeing about its name: the firm's series
    would have read UNX-2026-0053, INV-2026-0054, UNX-2026-0055. Rule 46(b)
    asks for one consecutive serial per financial year, and a series that
    changes its name halfway is not one series.

    It calls `ganit._doc_prefix` rather than re-reading the jsonb, for the same
    reason `_norm_state` above imports the state codelist instead of copying
    it: a second implementation of one rule is a second thing to drift, and
    this one already sanitises the value before it reaches a GST serial
    (`next_doc_number` builds `PREFIX-YYYY-NNNN` by concatenation, so a prefix
    carrying a hyphen or a digit makes the series unparseable by its own
    reader).

    Imported inside the function, not at module scope: `ganit.py` is a
    3,500-line module that imports `routers.graha`, `routers.vikray` and
    `routers.products` at import time, and this file is deliberately outside
    that graph. A local import keeps it that way and cannot be broken by the
    order `server.py` happens to mount routers in.
    """
    from routers.ganit import _doc_prefix
    return await _doc_prefix(pool, org_id, "tax_invoice")


async def _supplier_state(pool, org_id) -> str:
    """The state THIS firm supplies FROM, canonical, or '' if nobody has said.

    `staging.organisations.state_code`. BOTH in-scope organisations carry one
    (E2E Test '27', Unicode Group '24', measured 2026-08-26), so the refusal
    below never fires for either of them. It fires only for the three orgs the
    owner has put out of scope, which have no state_code and do not transact —
    and refusing there is the intended outcome, not a gap to close.
    """
    row = await pool.fetchrow(
        "SELECT state_code FROM staging.organisations WHERE id = $1::uuid",
        str(org_id))
    return _norm_state(row["state_code"]) if row else ""


def _tax_split(gst_treatment, supplier_state: str, place_of_supply: str):
    """(is_igst, refusal). A refusal is a REASON, never a default.

    ── WHY THIS REFUSES INSTEAD OF GUESSING ────────────────────────────────
    `is_igst` used to be `gst_treatment in ('overseas','sez')` and nothing else,
    so it never compared the two states — and every INTER-STATE DOMESTIC supply
    was taxed CGST+SGST when it legally attracts IGST. A Gujarat firm invoicing
    a Maharashtra client reported the wrong tax heads and paid the wrong
    governments. That was invisible while these routes 500'd; they work now.

    The honest split needs both ends, and either can be missing: the supplier's
    `organisations.state_code` is set on 2 of 5 live orgs, and a customer with
    no GSTIN and no address state has no place of supply. Defaulting a missing
    end to "intra-state" is the guess that produced the original bug, and it
    fails silently on a tax document somebody files. So this returns a refusal
    and the callers stop — a service line left uninvoiced this run is
    recoverable in a minute by filling the state in; a wrongly-taxed invoice
    that has gone to a customer and into a GSTR-1 is not.

    Overseas and SEZ are decided WITHOUT either state: the treatment settles it,
    which is why an export never blocks on a missing state_code.
    """
    if gst_treatment in ("overseas", "sez"):
        return True, None
    if not supplier_state:
        return None, ("this organisation has no state_code, so an invoice "
                      "cannot be taxed as inter- or intra-state. Set the "
                      "organisation's state in Settings -> Profile.")
    if not place_of_supply:
        return None, ("this customer has neither a GSTIN nor a state on their "
                      "address, so the place of supply is unknown and the "
                      "invoice cannot be taxed correctly.")
    return supplier_state != place_of_supply, None


def _place_of_supply(gstin, address) -> str:
    """The two-digit GST state code this invoice is supplied INTO.

    Both auto-invoice paths wrote nothing here and left the column at its ''
    default, on documents whose `invoice_type` defaults to 'tax_invoice'. That
    is the one field deciding whether a supply is inter- or intra-state, and
    `services/gstr1_json.py` reads it (`parse_state_code(row["place_of_supply"])`)
    to build the return — so an empty one produces a GSTR-1 row that cannot be
    classified, silently, because '' parses to None rather than raising.

    THE GSTIN FIRST, because its opening two digits ARE the state of
    registration and that is the figure a return is built on. The address is
    the fallback for an unregistered customer, who genuinely has no GSTIN and
    must still be invoiceable — the same rule that keeps GSTIN non-mandatory
    everywhere else in this product.

    Returns '' when neither answers, which is exactly what was written before:
    this can only improve the column, never blank one that was populated.
    """
    code = str(gstin or "").strip()[:2]
    if code in _GST_STATES:
        return code
    if isinstance(address, str):
        try:
            address = json.loads(address)
        except (ValueError, TypeError):
            address = None
    if isinstance(address, dict):
        return _norm_state(address.get("state")) or ""
    return ""

logger = logging.getLogger(__name__)


def _as_date(value: str, field: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, f"{field} is not a date (expected YYYY-MM-DD).")


def _assignments(body: BaseModel, fields, clearable: frozenset[str]):
    """SET clauses for exactly the fields the caller SENT, nulls included.

    ── WHY THIS EXISTS — `_NullMeansUnset`'S OTHER HALF ───────────────────────

    Every update handler in this file was written as::

        val = getattr(body, field)
        if val is not None:
            ...

    which reads "skip what wasn't provided" and in fact means "**a null can
    never clear a column**". On a create that asymmetry was the 422 that
    `_NullMeansUnset` fixed. On an update it is worse, because it does not
    refuse — it returns **200 and changes nothing**.

    ⚠ **A PAUSED SUBSCRIPTION COULD NEVER BE RESUMED.** Ending a service line
    writes `period_end`; resuming it means clearing that date, and `null` is
    the only spelling the form has for "there is no end date"
    (`ServiceLinesTab.save()` sends `period_end: form.period_end || null`). The
    loop above dropped it, the toast said "Service line updated", and the row
    stayed ended. The only way to bill that customer again was to create a
    second line and lose the first one's history. Found by proposal 93 Suite 17
    (17.04) on 2026-08-29.

    ── OMITTED IS NOT THE SAME AS NULL, AND PYDANTIC ALREADY KNOWS WHICH ──────

    `model_fields_set` holds the keys the request body actually carried, so
    "the caller said nothing about `notes`" and "the caller said `notes` is
    now empty" stop being the same input. That is the whole distinction the
    `is not None` test could not express, and it needs no new model.

    ── AND A NULL IS ONLY HONOURED WHERE THE COLUMN CAN HOLD ONE ─────────────

    `clearable` is the set of columns that are genuinely `NULL`-able, read from
    `information_schema.columns` on the live database 2026-08-29 rather than
    from a migration file::

        client_service_lines     period_end                     YES
        client_billing_profiles  credit_limit, notes            YES
        client_metered_usage     source_ref                     YES  (recorded_date NO)
        vendor_rate_cards        effective_to, notes            YES  (effective_from NO)

    A null against anything else stays dropped, exactly as today. Honouring it
    would send `SET recorded_date=NULL` at a `NOT NULL` column and turn a typo
    in a form into a 500 — and `RateCardsTab.save()` really does send
    `effective_from: form.effective_from || null` on every PATCH, so that path
    is walked, not hypothetical.
    """
    sent = body.model_fields_set
    updates: list[str] = []
    vals: list = []
    for field, cast in fields:
        if field not in sent:
            continue
        val = getattr(body, field)
        if val is None and field not in clearable:
            continue
        if cast == "::date":
            val = _as_date(val, field) if val else None
        vals.append(val)
        updates.append(f"{field}=${len(vals)}{cast}")
    return updates, vals


router = APIRouter(prefix="/api/v1/ganit/billing", tags=["client-billing"])

_gate = require_any_module("ganit", "graha", "vikray")
_vendor_gate = require_any_module("ganit", "kray")


# ── Pydantic models ──────────────────────────────────────────────────────

class ProfileCreate(_NullMeansUnset):
    client_id: str
    billing_cycle: str = "monthly"
    anchor_day: int = 1
    payment_terms_days: int = 30
    currency: str = "INR"
    gst_treatment: str = "registered"
    credit_limit: float | None = None
    notes: str = ""


class ProfileUpdate(BaseModel):
    billing_cycle: str | None = None
    anchor_day: int | None = None
    payment_terms_days: int | None = None
    currency: str | None = None
    gst_treatment: str | None = None
    credit_limit: float | None = None
    notes: str | None = None


class ServiceLineCreate(_NullMeansUnset):
    profile_id: str
    kind: str = "retainer"
    description: str = ""
    amount: float = 0
    cadence: str = "monthly"
    period_start: str
    period_end: str | None = None
    billing_direction: str = "advance"
    auto_invoice: bool = False


class ServiceLineUpdate(BaseModel):
    description: str | None = None
    amount: float | None = None
    period_end: str | None = None
    auto_invoice: bool | None = None


class MeteredUsageCreate(_NullMeansUnset):
    profile_id: str
    metric: str = ""
    quantity: float = 0
    unit: str = ""
    rate: float = 0
    recorded_date: str | None = None
    source_ref: str | None = None


class MeteredUsageUpdate(BaseModel):
    metric: str | None = None
    quantity: float | None = None
    unit: str | None = None
    rate: float | None = None
    recorded_date: str | None = None
    source_ref: str | None = None


class GenerateUsageInvoice(BaseModel):
    profile_id: str
    usage_ids: list[str] | None = None


class RateCardCreate(_NullMeansUnset):
    vendor_id: str
    item_category: str = ""
    rate: float = 0
    unit: str = ""
    effective_from: str | None = None
    effective_to: str | None = None
    proration_clause: bool = False
    notes: str = ""


class RateCardUpdate(BaseModel):
    item_category: str | None = None
    rate: float | None = None
    unit: str | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    proration_clause: bool | None = None
    notes: str | None = None


class SLACreditCreate(_NullMeansUnset):
    vendor_id: str
    rate_card_id: str | None = None
    sla_metric: str = ""
    threshold: float = 0
    actual: float = 0
    credit_amount: float = 0
    period: str
    status: str = "pending"


class SLACreditApply(BaseModel):
    bill_id: str


# ── Which columns a PATCH may set back to NULL ───────────────────────────
#
# Read off the LIVE database 2026-08-29, not off a migration file:
#
#   SELECT table_name, column_name, is_nullable
#     FROM information_schema.columns
#    WHERE table_name IN ('client_service_lines','vendor_rate_cards',
#                         'client_metered_usage','client_billing_profiles')
#      AND table_schema IN ('staging','public');
#
# Both product schemas were asked and only `staging` holds these four tables —
# a schema-qualified negative is a fact about that schema alone, and closing on
# one is how `public.report_schedules` was declared missing while it had a CRUD
# and an armed cron.
#
# These are the only columns where `null` from a form is a decision rather than
# an empty box. Everything else stays NOT NULL and a null against it is still
# dropped — see `_assignments`.
_CLEARABLE_PROFILE = frozenset({"credit_limit", "notes"})
_CLEARABLE_SERVICE_LINE = frozenset({"period_end"})
_CLEARABLE_METERED_USAGE = frozenset({"source_ref"})
_CLEARABLE_RATE_CARD = frozenset({"effective_to", "notes"})


# ── Profiles CRUD ────────────────────────────────────────────────────────

@router.get("/profiles")
async def list_profiles(
    client_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT p.*, c.name AS client_name "
        "FROM staging.client_billing_profiles p "
        # `AND c.org_id = p.org_id` is not belt-and-braces. A join on the id
        # ALONE is the documented cross-tenant leak shape in this repo: the
        # profile row is scoped by `p.org_id = $1`, but the client NAME it
        # carries is whatever row that uuid points at, in any organisation.
        # Every join to graha_clients in this file now carries the org
        # predicate; `create_profile` closes the other half by refusing to
        # store another org's client_id in the first place.
        "JOIN staging.graha_clients c "
        "  ON c.id = p.client_id AND c.org_id = p.org_id "
        "WHERE p.org_id = $1::uuid"
    )
    params: list = [org_id]
    if client_id:
        params.append(client_id)
        q += f" AND p.client_id = ${len(params)}::uuid"
    q += " ORDER BY c.name"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.get("/profiles/{profile_id}")
async def get_profile(
    profile_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT p.*, c.name AS client_name "
        "FROM staging.client_billing_profiles p "
        "JOIN staging.graha_clients c "
        "  ON c.id = p.client_id AND c.org_id = p.org_id "
        "WHERE p.id = $1::uuid AND p.org_id = $2::uuid",
        profile_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Billing profile not found")
    return dict(row)


@router.post("/profiles")
async def create_profile(
    body: ProfileCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # THE PARENT IS CHECKED BEFORE IT IS STORED — the same shape the three
    # sibling creators in this file already use (`create_service_line`,
    # `create_metered_usage`, `create_rate_card`): read the parent row
    # `WHERE id = $1 AND org_id = $2`, and 404 when it is not this org's.
    #
    # Without it `client_id` was written from the request body unverified, so
    # any org could bind a profile to another org's company — and
    # `list_profiles` then joined `graha_clients` on the id alone and rendered
    # that company's NAME back. The duplicate check below cannot stand in for
    # it: it is scoped `WHERE org_id = $1`, so a foreign client_id matches
    # nothing there and falls straight through to the INSERT.
    #
    # It runs BEFORE the 409 deliberately: a client this org cannot see is not
    # found, whatever else is true of it.
    client = await pool.fetchrow(
        "SELECT id FROM staging.graha_clients "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        body.client_id, org_id,
    )
    if not client:
        raise HTTPException(404, "Client not found")
    existing = await pool.fetchval(
        "SELECT id FROM staging.client_billing_profiles "
        "WHERE org_id = $1::uuid AND client_id = $2::uuid",
        org_id, body.client_id,
    )
    if existing:
        raise HTTPException(409, "Billing profile already exists for this client")
    row = await pool.fetchrow(
        "INSERT INTO staging.client_billing_profiles "
        "(org_id, client_id, billing_cycle, anchor_day, payment_terms_days, "
        " currency, gst_treatment, credit_limit, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::smallint, $5::int, $6, $7, $8, $9, $10) "
        "RETURNING *",
        org_id, body.client_id, body.billing_cycle, body.anchor_day,
        body.payment_terms_days, body.currency, body.gst_treatment,
        body.credit_limit, body.notes, user.get("user_id", ""),
    )
    return dict(row)


@router.patch("/profiles/{profile_id}")
async def update_profile(
    profile_id: UUID,
    body: ProfileUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    updates, vals = _assignments(
        body,
        (("billing_cycle", ""), ("anchor_day", "::smallint"),
         ("payment_terms_days", "::int"), ("currency", ""),
         ("gst_treatment", ""), ("credit_limit", ""), ("notes", "")),
        _CLEARABLE_PROFILE,
    )
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals.append(str(profile_id))
    vals.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.client_billing_profiles SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Billing profile not found")
    return dict(row)


# ── Service Lines CRUD ───────────────────────────────────────────────────

@router.get("/service-lines")
async def list_service_lines(
    profile_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT sl.*, p.client_id, c.name AS client_name "
        "FROM staging.client_service_lines sl "
        "JOIN staging.client_billing_profiles p ON p.id = sl.profile_id "
        "JOIN staging.graha_clients c "
        "  ON c.id = p.client_id AND c.org_id = p.org_id "
        "WHERE sl.org_id = $1::uuid"
    )
    params: list = [org_id]
    if profile_id:
        params.append(profile_id)
        q += f" AND sl.profile_id = ${len(params)}::uuid"
    q += " ORDER BY sl.period_start DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/service-lines")
async def create_service_line(
    body: ServiceLineCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    profile = await pool.fetchrow(
        "SELECT id FROM staging.client_billing_profiles "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        body.profile_id, org_id,
    )
    if not profile:
        raise HTTPException(404, "Billing profile not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.client_service_lines "
        "(org_id, profile_id, kind, description, amount, cadence, "
        " period_start, period_end, billing_direction, auto_invoice, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11) "
        "RETURNING *",
        org_id, body.profile_id, body.kind, body.description,
        body.amount, body.cadence,
        _as_date(body.period_start, "period_start"),
        _as_date(body.period_end, "period_end") if body.period_end else None,
        body.billing_direction, body.auto_invoice,
        user.get("user_id", ""),
    )
    return dict(row)


@router.patch("/service-lines/{line_id}")
async def update_service_line(
    line_id: UUID,
    body: ServiceLineUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # `period_end` is in `_CLEARABLE_SERVICE_LINE`, and that is what RESUMES a
    # paused subscription: clearing the end date is the only way the product
    # has to say "this line is running again". See `_assignments`.
    updates, vals = _assignments(
        body,
        (("description", ""), ("amount", ""),
         ("period_end", "::date"), ("auto_invoice", "")),
        _CLEARABLE_SERVICE_LINE,
    )
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals.append(str(line_id))
    vals.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.client_service_lines SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Service line not found")
    return dict(row)


# ── P5.2: Auto-Invoice Sweep ────────────────────────────────────────────

async def sweep_client_auto_invoices(
    today: date | None = None,
    org_id: str | None = None,
) -> dict:
    """Generate DRAFT ganit_invoices for client_service_lines due today.

    Called from the billing cron.  For each auto_invoice line whose current
    period is due, creates a ganit_invoices row and a client_invoice_lines
    join row to prevent double-billing.

    Draft is written explicitly at the INSERT — see the note there. Nobody is
    watching a cron, and `doc_status` DEFAULTS to 'final', so this was the one
    path in the product that could reach `final` without passing
    `ganit._refuse_final_if_incomplete`. A person issues it from the register.

    `org_id` SCOPES THE RUN TO ONE ORGANISATION, and the cron does not pass it —
    a nightly sweep is for everybody, which is the whole point of it. It exists
    because this function WRITES TAX INVOICES with serial numbers drawn from a
    firm's live sequence, and staging shares its database with production
    (CLAUDE.md): proving the sweep works must be possible without raising a
    document in a real customer's books. Phase 3's own definition of done says
    the rows may move off zero "in staging test data only". This is how.
    """
    today = today or date.today()
    pool = await get_pool()

    lines = await pool.fetch(
        "SELECT sl.*, p.client_id, p.gst_treatment, p.anchor_day, "
        "       p.billing_cycle, p.payment_terms_days, p.currency, "
        # The customer's own registration and address, for `place_of_supply`.
        # Read on the join that is already here rather than in a second query
        # per line: the sweep runs over every org's service lines at once.
        "       c.name AS client_name, c.gstin AS client_gstin, "
        "       c.address AS client_address "
        "FROM staging.client_service_lines sl "
        "JOIN staging.client_billing_profiles p ON p.id = sl.profile_id "
        # This sweep runs for EVERY org at once (the cron has no org), so
        # `p.org_id` is the only anchor there is — and that makes the org
        # predicate load-bearing rather than defensive: without it the name
        # that lands in the invoice's `notes` and in the cron's log line is
        # whichever org's client shares that uuid.
        "JOIN staging.graha_clients c "
        "  ON c.id = p.client_id AND c.org_id = p.org_id "
        "WHERE sl.auto_invoice = TRUE "
        "  AND sl.period_start <= $1::date "
        "  AND (sl.period_end IS NULL OR sl.period_end > $1::date) "
        # `$2 IS NULL OR …` rather than two spellings of the statement: one
        # statement is one thing to plan, one thing to test, and one thing for
        # `test_client_billing_invoices.py` to parse against the real schema.
        "  AND ($2::uuid IS NULL OR sl.org_id = $2::uuid)",
        today, str(org_id) if org_id else None,
    )

    created = 0
    skipped = 0

    # Each org's own state, read ONCE per run rather than per service line: this
    # sweep has no org of its own (the cron runs it for everybody), so the state
    # varies by row and a naive read would be a query per line.
    _supplier_states: dict[str, str] = {}
    # The serial prefix is the same shape of fact — per org, constant for the
    # run — so it is read alongside the state rather than once per invoice. See
    # `_tax_invoice_prefix` for why it stopped being the literal "INV".
    _prefixes: dict[str, str] = {}
    for _oid in {str(row["org_id"]) for row in lines}:
        _supplier_states[_oid] = await _supplier_state(pool, _oid)
        _prefixes[_oid] = await _tax_invoice_prefix(pool, _oid)

    for sl in lines:
        anchor = sl["anchor_day"]
        cadence = sl["cadence"]
        if cadence == "one_off":
            period_start = sl["period_start"]
        else:
            # ── WHERE THE PERIOD COMES FROM, AND WHY IT IS NOT THE LINE'S OWN ──
            #
            # This read `next_anchor(anchor, sl["period_start"])` — the FIRST
            # anchor on or after the line's origin — recomputed on every sweep.
            # It is a constant: a retainer created in August answered "1 August"
            # in August, in September, and in August next year. The first run
            # invoiced it, `client_invoice_lines` then held that period for ever,
            # and every run after it fell into the `already` branch below. A
            # MONTHLY RETAINER INVOICED EXACTLY ONCE, FOR EVER. Nothing in the
            # product said so: the sweep reported `skipped`, which is what it
            # also says about a line that is genuinely not due yet.
            #
            # The period advances from THE LAST ONE INVOICED, which is the only
            # record of where this line has got to. `client_invoice_lines` is
            # that record — it exists to stop double-billing, and the same rows
            # answer "how far along is this line?" — so the two questions cannot
            # come to disagree the way a `next_billing_date` column on the line
            # would the first time an invoice was voided.
            #
            # `period_end_for` rather than `next_anchor(..., last + 1 day)`:
            # one cycle after the last invoiced start is a month, a quarter or a
            # year depending on the cadence, and it lands back on the anchor day
            # by construction because the last start was on it.
            #
            # ONE PERIOD PER LINE PER RUN, deliberately. A line dormant for a
            # year does not mint twelve invoices on the morning somebody notices
            # — it invoices the oldest unbilled period and catches up a period a
            # day, on a sweep that runs daily. Twelve tax invoices appearing at
            # once, unattended, with twelve serials drawn, is not a thing to do
            # to a customer's books without a person deciding it.
            last_billed = await pool.fetchval(
                "SELECT MAX(period_start) FROM staging.client_invoice_lines "
                "WHERE line_id = $1::uuid",
                sl["id"],
            )
            # AND WHERE A LINE WITH NO HISTORY STARTS. `invoice_from` (migration
            # 223) is a floor, not a start date: `period_start` keeps saying when
            # the service began — it is the firm's own contract term and the
            # screen shows it — while this says the earliest period this system
            # may raise. A service that ran for four months before anybody armed
            # a cron needs both facts, and rewriting `period_start` to start the
            # clock would have left the true one nowhere.
            #
            # HISTORY WINS. The floor applies only to the never-invoiced branch:
            # a line with invoiced periods is not sent backwards or forwards by
            # a column somebody edits later.
            first = next_anchor(anchor, sl["period_start"])
            if sl["invoice_from"]:
                first = max(first, next_anchor(anchor, sl["invoice_from"]))
            period_start = (
                period_end_for(last_billed, cadence) if last_billed else first
            )

        # NO SEPARATE "past the line's end" GUARD, and that is checked rather
        # than assumed: the outer query already keeps only lines whose
        # `period_end` is NULL or later than today, so a period that starts on
        # or after the line's end necessarily starts after today and is skipped
        # by the line above. A second check here would be a branch no run can
        # reach, which is worse than no check — it reads as protection.
        if period_start > today:
            skipped += 1
            continue

        period_end = period_end_for(period_start, cadence) if cadence != "one_off" else period_start

        already = await pool.fetchval(
            "SELECT 1 FROM staging.client_invoice_lines "
            "WHERE line_id = $1::uuid AND period_start = $2::date",
            sl["id"], period_start,
        )
        if already:
            skipped += 1
            continue

        amount = float(sl["amount"])
        place_of_supply = _place_of_supply(sl["client_gstin"], sl["client_address"])
        # REFUSED, NOT DEFAULTED. See `_tax_split`: a missing state used to mean
        # "intra-state", which taxed every inter-state supply under the wrong
        # heads. This sweep is unattended, so it skips the line and says why —
        # the period stays uninvoiced and is picked up on the next run once the
        # state is filled in. `skipped` already counts lines this run passed
        # over, and `continue` happens BEFORE the serial is drawn, so no invoice
        # number is spent on a document that is not written.
        is_igst, refusal = _tax_split(
            sl["gst_treatment"],
            _supplier_states.get(str(sl["org_id"]), ""),
            place_of_supply)
        if refusal:
            skipped += 1
            logger.warning(
                "Auto-invoice SKIPPED for %s (%s): %s",
                sl["client_name"], sl["description"], refusal,
            )
            continue
        # A LOCAL, NOT A COLUMN. `staging.ganit_invoices` has no `gst_rate`
        # and never has (54 columns live, checked 2026-08-25); naming it in
        # the column list is why this INSERT raised UndefinedColumnError on
        # every call it has ever received. The rate belongs on the LINE in
        # this schema — `line_items[].gst_rate`, which is where ganit.py puts
        # it and where pay.py reads it — and this sweep writes no lines yet.
        gst_rate = 18
        gst_amount = round(amount * gst_rate / 100, 2)
        total = round(amount + gst_amount, 2)
        due_date = today + __import__("datetime").timedelta(days=sl["payment_terms_days"])

        # THE SERIAL IS DRAWN LAST, after every skip above has had its chance.
        # `next_doc_number` is the only allocator (utils.py) and it burns a
        # number the moment it returns; a refusal after this line leaves a
        # permanent gap in the invoice sequence, which is the thing a tax
        # auditor asks about.
        #
        # `str(...)`, not the raw asyncpg UUID: the allocator keys its advisory
        # lock on `hash((org_id, table))`, and a UUID object and its string
        # hash differently — a caller passing the other type would take a
        # DIFFERENT lock and not be serialised against ganit.py or vikray.py,
        # which both pass the str. Called outside the transaction below because
        # it acquires a connection of its own.
        invoice_number = await next_doc_number(
            pool, str(sl["org_id"]), "ganit_invoices", "invoice_number",
            _prefixes.get(str(sl["org_id"]), "INV"))

        # THE LINE PARTICULARS. `ganit_invoices.line_items` is NOT NULL DEFAULT
        # '[]'::jsonb, so omitting it did not fail — it minted a tax invoice
        # with an EMPTY BODY. `routers/pay.py` builds the customer's payment
        # page as `[_line(li) for li in (items or [])]`, so the client opened
        # the link to a total with nothing explaining it; Rule 46 requires the
        # description, rate and amount that were being dropped; and every other
        # final-invoice path in this product passes
        # `ganit._refuse_final_if_incomplete`, which this one does not reach.
        #
        # The shape is `generate_usage_invoice`'s below, deliberately — the two
        # write to the same column and a reader cannot be asked to handle two
        # spellings of one line. `gst_rate` rides the LINE because
        # `ganit_invoices` has no such column, which this file's own comment
        # says twice and is what the 500 was about.
        #
        # `cost_basis` rides the line for the same reason `gst_rate` does:
        # there is no column for it, and a line that records neither a cost
        # nor the reason it has none is a document a margin report can only
        # guess at. A service line has no product behind it — see
        # NO_COST_BASIS for why that means saying so rather than snapshotting.
        line_items = [{
            "description": f"{sl['description']} ({period_start} – {period_end})",
            "quantity": 1,
            "rate": amount,
            "gst_rate": gst_rate,
            "amount": amount,
            "cost_basis": NO_COST_BASIS,
        }]
        invoice_id = uuid4()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO staging.ganit_invoices "
                    "(id, org_id, client_id, billing_profile_id, invoice_number, "
                    " invoice_date, due_date, line_items, subtotal, "
                    " cgst, sgst, igst, total, balance_due, payment_status, "
                    " notes, created_by, is_igst, place_of_supply, doc_status) "
                    # $12 is bound twice — `total` and `balance_due` — the same
                    # convention ganit.py and vikray.py use. `balance_due`
                    # DEFAULTS to 0, so omitting it mints an invoice that reads
                    # as FULLY PAID against a non-zero total: invisible in
                    # receivables and ageing, ₹0 on the customer's payment link,
                    # and un-editable because editing is bounded by payment.
                    "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, "
                    "        $6::date, $7::date, $8::jsonb, $9, "
                    "        $10, $11, $12, $13, $13, 'unpaid', "
                    # DRAFT, EXPLICITLY — and this is the ONE unattended writer
                    # in the product, which is why it matters more here than in
                    # the sibling below.
                    #
                    # `doc_status` DEFAULTS to 'final' (read from `pg_attrdef`
                    # 2026-08-29, not from a migration file), so omitting it
                    # meant a CRON minted a FINISHED tax invoice, with a Rule
                    # 46(b) serial spent on it, without any person seeing the
                    # document and without it ever passing
                    # `ganit._refuse_final_if_incomplete`. Every other path to
                    # `final` in this product clears that gate; this one did not
                    # reach it, and it is the only one nobody is watching.
                    #
                    # ⚠ THIS HAS FIRED. It is not a latent hole. The Phase 3.3
                    # acceptance (`docs/plans/PROGRESS.md`, 2026-08-27) records
                    # `/cron/billing` raising INV-2026-0093 (₹88,500) and
                    # INV-2026-0094 (₹17,700) against Unicode Group, serials
                    # drawn from that firm's own live series — two finished tax
                    # invoices, unattended, ungated. Both rows are gone now,
                    # deleted by the 93 Stage 2 reseed on 08-28, which is the
                    # only reason a count today reads zero: A ZERO THAT MEANS
                    # "WIPED", NOT "NEVER". And `billing` is in `cron-daily`'s
                    # loop, read off the Railway start command 2026-08-29 —
                    # STATUS.md still says that step is outstanding.
                    #
                    # WHY DRAFT RATHER THAN RUNNING THE GATE HERE. Both were on
                    # the table. Running the gate would mean deciding what an
                    # unattended sweep does with a row that FAILS it, and every
                    # answer is worse than a draft: skipping leaves a monthly
                    # retainer silently unbilled — the exact shape of the
                    # "invoiced exactly once, for ever" defect the period logic
                    # above exists to prevent, and the kind a firm discovers at
                    # year end. Nothing is thrown away here: the invoice is
                    # created, numbered, visible on the register and finalised
                    # by a person through `Mark final`
                    # (`InvoiceDetail.jsx` -> `PATCH /invoices/{id}/status`),
                    # which DOES run the gate — and runs it with `client_id`,
                    # so the Rule 46(e) company fallback fires for these rows,
                    # which carry a company and no named person.
                    #
                    # It is also what the sibling `generate_usage_invoice`
                    # already writes, for the same reasons, and the two are one
                    # file writing one column: a sweep minting `final` beside a
                    # button minting `draft` was the inconsistency, not a
                    # design. The draft filter on the statement of account, the
                    # revenue tile and dunning is what separates "counted and
                    # chased" from "not", so a document nobody reviewed no
                    # longer reaches a customer's statement.
                    "        $14, 'system', $15, $16, 'draft')",
                    str(invoice_id), sl["org_id"], sl["client_id"],
                    sl["profile_id"], invoice_number,
                    today, due_date, json.dumps(line_items), amount,
                    0 if is_igst else round(gst_amount / 2, 2),
                    0 if is_igst else round(gst_amount / 2, 2),
                    gst_amount if is_igst else 0,
                    total,
                    f"Auto-invoice: {sl['description']} ({period_start} – {period_end})",
                    is_igst, place_of_supply,
                )
                await conn.execute(
                    "INSERT INTO staging.client_invoice_lines "
                    "(invoice_id, line_id, period_start, amount) "
                    "VALUES ($1::uuid, $2::uuid, $3::date, $4)",
                    str(invoice_id), sl["id"], period_start, amount,
                )
        created += 1
        logger.info(
            # "as a DRAFT" is in the line because the cron's log is the only
            # place anybody sees this run. A sweep reporting "Auto-invoiced"
            # for a document that has not been issued would read as money
            # already billed, which is the same misreading `created` invites.
            "Auto-invoiced %s for %s: %s – %s, ₹%.2f — as a DRAFT, awaiting "
            "Mark final",
            sl["client_name"], sl["description"], period_start, period_end, total,
        )

    return {"date": str(today), "created": created, "skipped": skipped}


# ── P5.3: Metered Usage CRUD ───────────────────────────────────────────

@router.get("/metered-usage")
async def list_metered_usage(
    profile_id: str = "",
    invoiced: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    q = (
        "SELECT u.*, p.client_id, c.name AS client_name "
        "FROM staging.client_metered_usage u "
        "JOIN staging.client_billing_profiles p ON p.id = u.profile_id "
        "JOIN staging.graha_clients c "
        "  ON c.id = p.client_id AND c.org_id = p.org_id "
        "WHERE u.org_id = $1::uuid"
    )
    params: list = [org_id]
    if profile_id:
        params.append(profile_id)
        q += f" AND u.profile_id = ${len(params)}::uuid"
    if invoiced in ("true", "false"):
        params.append(invoiced == "true")
        q += f" AND u.invoiced = ${len(params)}::bool"
    q += " ORDER BY u.recorded_date DESC, u.created_at DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/metered-usage")
async def create_metered_usage(
    body: MeteredUsageCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    profile = await pool.fetchrow(
        "SELECT id FROM staging.client_billing_profiles "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        body.profile_id, org_id,
    )
    if not profile:
        raise HTTPException(404, "Billing profile not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.client_metered_usage "
        "(org_id, profile_id, metric, quantity, unit, rate, "
        " recorded_date, source_ref, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, "
        "        COALESCE($7::date, CURRENT_DATE), $8, $9) "
        "RETURNING *",
        org_id, body.profile_id, body.metric, body.quantity,
        body.unit, body.rate,
        _as_date(body.recorded_date, "recorded_date") if body.recorded_date else None,
        body.source_ref, user.get("user_id", ""),
    )
    return dict(row)


@router.patch("/metered-usage/{usage_id}")
async def update_metered_usage(
    usage_id: UUID,
    body: MeteredUsageUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    already = await pool.fetchval(
        "SELECT invoiced FROM staging.client_metered_usage "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        usage_id, org_id,
    )
    if already is None:
        raise HTTPException(404, "Usage entry not found")
    if already:
        raise HTTPException(409, "Cannot edit usage that has already been invoiced")
    updates, vals = _assignments(
        body,
        (("metric", ""), ("quantity", ""), ("unit", ""), ("rate", ""),
         ("recorded_date", "::date"), ("source_ref", "")),
        _CLEARABLE_METERED_USAGE,
    )
    if not updates:
        raise HTTPException(400, "Nothing to update")
    vals.append(str(usage_id))
    vals.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.client_metered_usage SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Usage entry not found")
    return dict(row)


@router.delete("/metered-usage/{usage_id}")
async def delete_metered_usage(
    usage_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT invoiced FROM staging.client_metered_usage "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        usage_id, org_id,
    )
    if not row:
        raise HTTPException(404, "Usage entry not found")
    if row["invoiced"]:
        raise HTTPException(409, "Cannot delete usage that has already been invoiced")
    await pool.execute(
        "DELETE FROM staging.client_metered_usage "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        usage_id, org_id,
    )
    return {"ok": True}


# ── P5.3: Generate Invoice from Unbilled Usage ─────────────────────────

@router.post("/metered-usage/generate-invoice")
async def generate_usage_invoice(
    body: GenerateUsageInvoice,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Roll unbilled metered-usage rows into a DRAFT ganit_invoices row.

    Draft is written explicitly at the INSERT — see the note there. The
    caller finalises through the normal invoice route once the lines have
    been read, which is the review this button's output has always implied
    and never had.
    """
    pool = await get_pool()

    profile = await pool.fetchrow(
        "SELECT p.*, c.name AS client_name, c.gstin AS client_gstin, "
        "       c.address AS client_address "
        "FROM staging.client_billing_profiles p "
        "JOIN staging.graha_clients c "
        "  ON c.id = p.client_id AND c.org_id = p.org_id "
        "WHERE p.id = $1::uuid AND p.org_id = $2::uuid",
        body.profile_id, org_id,
    )
    if not profile:
        raise HTTPException(404, "Billing profile not found")

    if body.usage_ids:
        placeholders = ", ".join(f"${i+3}::uuid" for i in range(len(body.usage_ids)))
        q = (
            f"SELECT * FROM staging.client_metered_usage "
            f"WHERE org_id = $1::uuid AND profile_id = $2::uuid "
            f"AND invoiced = FALSE AND id IN ({placeholders}) "
            f"ORDER BY recorded_date"
        )
        usage_rows = await pool.fetch(q, org_id, body.profile_id, *body.usage_ids)
    else:
        usage_rows = await pool.fetch(
            "SELECT * FROM staging.client_metered_usage "
            "WHERE org_id = $1::uuid AND profile_id = $2::uuid AND invoiced = FALSE "
            "ORDER BY recorded_date",
            org_id, body.profile_id,
        )

    if not usage_rows:
        raise HTTPException(400, "No unbilled usage entries to invoice")

    # A LOCAL, NOT A COLUMN — see the sweep above. `ganit_invoices.gst_rate`
    # does not exist, and naming it here is why this route 500'd on every call.
    # Bound BEFORE the loop because each line now carries it: the rate has to
    # live somewhere, and with no column to hold it the line is where every
    # reader in this product looks for it.
    gst_rate = 18

    line_items = []
    subtotal = 0.0
    for u in usage_rows:
        amount = round(float(u["quantity"]) * float(u["rate"]), 2)
        line_items.append({
            "description": f"{u['metric']}: {u['quantity']} {u['unit']} @ {u['rate']}",
            "quantity": float(u["quantity"]),
            "rate": float(u["rate"]),
            # `pay.py:_line` and the GST builders read the rate from the
            # line. Without it the customer sees a taxed total with no rate
            # behind it, and the return has to guess.
            "gst_rate": gst_rate,
            "amount": amount,
            # PER LINE, inside the loop — see NO_COST_BASIS. Metered usage is
            # sold by the unit and a profile may report several metrics, so a
            # marker set once outside this loop would leave every line after
            # the first saying nothing.
            "cost_basis": NO_COST_BASIS,
        })
        subtotal += amount

    subtotal = round(subtotal, 2)

    # REFUSED, NOT DEFAULTED — see `_tax_split`. A user pressed a button, so
    # this one answers rather than skipping silently: a 400 naming the missing
    # fact is actionable in a minute, and it is raised BEFORE the serial is
    # drawn and before any usage row is marked invoiced, so nothing is spent or
    # consumed by a call that does not write an invoice.
    place_of_supply = _place_of_supply(profile["client_gstin"],
                                       profile["client_address"])
    is_igst, refusal = _tax_split(
        profile["gst_treatment"],
        await _supplier_state(pool, org_id),
        place_of_supply)
    if refusal:
        raise HTTPException(400, f"Cannot raise this invoice: {refusal}")
    gst_amount = round(subtotal * gst_rate / 100, 2)
    total = round(subtotal + gst_amount, 2)
    today = date.today()
    due_date = today + __import__("datetime").timedelta(days=profile["payment_terms_days"])

    # After both refusals above (unknown profile, nothing unbilled) and before
    # the transaction: a serial spent on a call that then fails is a gap in the
    # sequence, and `next_doc_number` acquires its own connection.
    invoice_number = await next_doc_number(
        pool, org_id, "ganit_invoices", "invoice_number",
        await _tax_invoice_prefix(pool, org_id))

    invoice_id = uuid4()
    usage_ids = [u["id"] for u in usage_rows]
    uid = user.get("user_id", "")

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO staging.ganit_invoices "
                "(id, org_id, client_id, billing_profile_id, invoice_number, "
                " invoice_date, due_date, line_items, subtotal, "
                " cgst, sgst, igst, total, balance_due, payment_status, "
                " notes, created_by, is_igst, place_of_supply, doc_status) "
                # $13 twice: total and balance_due. See the sweep's note — the
                # column DEFAULTS to 0 and an omitted one reads as fully paid.
                "VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, "
                "        $6::date, $7::date, $8::jsonb, $9, "
                "        $10, $11, $12, $13, $13, 'unpaid', "
                # DRAFT, EXPLICITLY. `doc_status` DEFAULTS to 'final', so
                # omitting it made this route contradict its own docstring
                # ("into a draft ganit_invoices row") and mint a finished tax
                # invoice the moment a user pressed Generate. It matters more
                # now than it did: the draft filter added for the statement of
                # account and the revenue tile is what separates "counted and
                # dunned" from "not", so a document nobody had reviewed was
                # being sent to the customer's statement. Finalising is a real
                # route (`ganit.py` set_doc_status), so a draft is reviewable,
                # not stranded.
                "        $14, $15, $16, $17, 'draft')",
                str(invoice_id), org_id, profile["client_id"],
                profile["id"], invoice_number,
                today, due_date, json.dumps(line_items), subtotal,
                0 if is_igst else round(gst_amount / 2, 2),
                0 if is_igst else round(gst_amount / 2, 2),
                gst_amount if is_igst else 0,
                total,
                f"Metered usage invoice for {profile['client_name']}",
                uid, is_igst,
                place_of_supply,
            )
            placeholders = ", ".join(f"${i+2}::uuid" for i in range(len(usage_ids)))
            await conn.execute(
                f"UPDATE staging.client_metered_usage SET invoiced = TRUE "
                f"WHERE org_id = $1::uuid AND id IN ({placeholders})",
                org_id, *[str(uid) for uid in usage_ids],
            )

    logger.info(
        "Generated metered invoice %s for %s: %d entries, ₹%.2f",
        invoice_id, profile["client_name"], len(usage_rows), total,
    )
    return {
        "invoice_id": str(invoice_id),
        # Additive. The serial is the only handle a firm can quote to its
        # customer or find the document by; every other invoice-creating route
        # returns it, and this one had none to return.
        "invoice_number": invoice_number,
        "entries": len(usage_rows),
        "subtotal": subtotal,
        "total": total,
    }


# ── P5.4: Vendor Rate Cards ─────────────────────────────────────────────

@router.get("/rate-cards")
async def list_rate_cards(
    vendor_id: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    q = (
        "SELECT rc.*, v.name AS vendor_name "
        "FROM staging.vendor_rate_cards rc "
        "JOIN staging.ganit_vendors v ON v.id = rc.vendor_id "
        "WHERE rc.org_id = $1::uuid"
    )
    params: list = [org_id]
    if vendor_id:
        params.append(vendor_id)
        q += f" AND rc.vendor_id = ${len(params)}::uuid"
    q += " ORDER BY rc.effective_from DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/rate-cards")
async def create_rate_card(
    body: RateCardCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    vendor = await pool.fetchrow(
        "SELECT id FROM staging.ganit_vendors WHERE id = $1::uuid AND org_id = $2::uuid",
        body.vendor_id, org_id,
    )
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.vendor_rate_cards "
        "(org_id, vendor_id, item_category, rate, unit, effective_from, "
        " effective_to, proration_clause, notes, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, "
        "        COALESCE($6::date, CURRENT_DATE), $7::date, $8, $9, $10) "
        "RETURNING *",
        org_id, body.vendor_id, body.item_category, body.rate, body.unit,
        _as_date(body.effective_from, "effective_from") if body.effective_from else None,
        _as_date(body.effective_to, "effective_to") if body.effective_to else None,
        body.proration_clause,
        body.notes, user.get("user_id", ""),
    )
    return dict(row)


@router.patch("/rate-cards/{card_id}")
async def update_rate_card(
    card_id: UUID,
    body: RateCardUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    updates, vals = _assignments(
        body,
        (("item_category", ""), ("rate", ""), ("unit", ""),
         ("effective_from", "::date"), ("effective_to", "::date"),
         ("proration_clause", ""), ("notes", "")),
        _CLEARABLE_RATE_CARD,
    )
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at=NOW()")
    vals.append(str(card_id))
    vals.append(org_id)
    row = await pool.fetchrow(
        f"UPDATE staging.vendor_rate_cards SET {', '.join(updates)} "
        f"WHERE id=${len(vals)-1}::uuid AND org_id=${len(vals)}::uuid RETURNING *",
        *vals,
    )
    if not row:
        raise HTTPException(404, "Rate card not found")
    return dict(row)


@router.delete("/rate-cards/{card_id}")
async def delete_rate_card(
    card_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    """Remove a supplier price list — unless an SLA credit is priced off it.

    ── WHY THIS ROUTE DID NOT EXIST, AND WHAT THE USER SAW INSTEAD ────────────

    `RateCardsTab.jsx` has always rendered a Delete button and always called
    `DELETE /v1/ganit/billing/rate-cards/{id}`. The path published **PATCH and
    nothing else**, so FastAPI answered **405** and the screen showed the
    customer the words "Method Not Allowed" — measured live 2026-08-29,
    `DELETE …/1527e774-…` → `405 {"detail":"Method Not Allowed"}`. That is the
    third instance in this module of one shape: *the API can do it and the
    screen offers no way to ask*, or its mirror, *the screen asks and there is
    no route behind it*. `routers/graha.py` records the other two by name in
    its own comments — `territory_id` ("a territory could be defined and never
    used") and `contact_id` ("The column was writable and unreachable").

    ── A HARD DELETE, NOT AN ARCHIVE, AND WHY THAT IS THE RIGHT CALL ─────────

    A price list that has been used to price something is history and must not
    evaporate — but `effective_to` **already expresses retirement**, and the
    form offers it. What the screen had no way to do was undo a *mistyped* row,
    which is what every other list in this module can do. So the missing verb
    is genuinely delete, and adding a second "archived" state would give this
    table two ways to say retired and no way to say wrong.

    ── THE FENCE, MEASURED RATHER THAN ASSUMED ──────────────────────────────

    `pg_constraint`, live 2026-08-29 — one foreign key reaches this table::

        vendor_sla_credits_rate_card_id_fkey
            FOREIGN KEY (rate_card_id) REFERENCES staging.vendor_rate_cards(id)

    No `ON DELETE` clause, so the default `NO ACTION` applies and the database
    would raise a `ForeignKeyViolationError` — which FastAPI turns into an
    opaque **500 with nothing on screen**, this repo's signature failure. It is
    not hypothetical: of Unicode Group's three rate cards, **two are referenced
    by an SLA credit** (measured the same day). So the check is walked on the
    first real attempt, not held in reserve.

    A 409 that NAMES the credits is what a person can act on, and it is the
    module's own precedent — `delete_metered_usage` refuses in exactly this
    shape when the usage has been invoiced. The credit is deleted or
    re-pointed first, and then the card goes.
    """
    pool = await get_pool()
    card = await pool.fetchrow(
        "SELECT id, item_category FROM staging.vendor_rate_cards "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        card_id, org_id,
    )
    if not card:
        raise HTTPException(404, "Rate card not found")

    # Org-scoped on BOTH sides. The FK alone is not a tenancy check: it proves
    # the credit points at this card, not that the credit belongs to the caller.
    holders = await pool.fetch(
        "SELECT sla_metric, period FROM staging.vendor_sla_credits "
        "WHERE rate_card_id = $1::uuid AND org_id = $2::uuid "
        "ORDER BY period DESC",
        card_id, org_id,
    )
    if holders:
        # Named, not counted: "2 SLA credits" sends somebody hunting. The first
        # five are enough to find them and the tail is stated rather than
        # dropped, so the sentence never under-reports what is in the way.
        shown = holders[:5]
        named = ", ".join(
            f"{h['sla_metric'] or 'an SLA credit'} ({h['period']})" for h in shown
        )
        if len(holders) > len(shown):
            named += f", and {len(holders) - len(shown)} more"
        raise HTTPException(
            409,
            f"\"{card['item_category']}\" prices {len(holders)} SLA credit(s) — {named}. "
            "Delete or re-point those credits first, or set an Effective To date "
            "to retire the card without losing what it priced.",
        )

    await pool.execute(
        "DELETE FROM staging.vendor_rate_cards "
        "WHERE id = $1::uuid AND org_id = $2::uuid",
        card_id, org_id,
    )
    logger.info("Rate card %s (%s) deleted by %s",
                card_id, card["item_category"], user.get("user_id", ""))
    return {"ok": True}


# ── P5.4: SLA Credits ────────────────────────────────────────────────────

@router.get("/sla-credits")
async def list_sla_credits(
    vendor_id: str = "",
    status: str = "",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    q = (
        "SELECT sc.*, v.name AS vendor_name "
        "FROM staging.vendor_sla_credits sc "
        "JOIN staging.ganit_vendors v ON v.id = sc.vendor_id "
        "WHERE sc.org_id = $1::uuid"
    )
    params: list = [org_id]
    if vendor_id:
        params.append(vendor_id)
        q += f" AND sc.vendor_id = ${len(params)}::uuid"
    if status:
        params.append(status)
        q += f" AND sc.status = ${len(params)}"
    q += " ORDER BY sc.period DESC"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


@router.post("/sla-credits")
async def create_sla_credit(
    body: SLACreditCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    vendor = await pool.fetchrow(
        "SELECT id FROM staging.ganit_vendors WHERE id = $1::uuid AND org_id = $2::uuid",
        body.vendor_id, org_id,
    )
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.vendor_sla_credits "
        "(org_id, vendor_id, rate_card_id, sla_metric, threshold, actual, "
        " credit_amount, period, status, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, "
        "        $7, $8::date, $9, $10) "
        "RETURNING *",
        org_id, body.vendor_id, body.rate_card_id, body.sla_metric,
        body.threshold, body.actual, body.credit_amount,
        _as_date(body.period, "period"),
        body.status, user.get("user_id", ""),
    )
    return dict(row)


@router.post("/sla-credits/{credit_id}/apply")
async def apply_sla_credit(
    credit_id: UUID,
    body: SLACreditApply,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            credit = await conn.fetchrow(
                "SELECT * FROM staging.vendor_sla_credits "
                "WHERE id = $1::uuid AND org_id = $2::uuid",
                credit_id, org_id,
            )
            if not credit:
                raise HTTPException(404, "SLA credit not found")
            if credit["status"] != "pending":
                raise HTTPException(409, "SLA credit is not pending")
            bill = await conn.fetchrow(
                "SELECT id FROM staging.ganit_vendor_bills "
                "WHERE id = $1::uuid AND org_id = $2::uuid",
                body.bill_id, org_id,
            )
            if not bill:
                raise HTTPException(404, "Vendor bill not found")
            row = await conn.fetchrow(
                "UPDATE staging.vendor_sla_credits "
                "SET status = 'applied', applied_to_bill = $1::uuid "
                "WHERE id = $2::uuid AND org_id = $3::uuid RETURNING *",
                body.bill_id, credit_id, org_id,
            )
            await conn.execute(
                "UPDATE staging.ganit_vendor_bills "
                "SET sla_credit_applied = COALESCE(sla_credit_applied, 0) + $1 "
                "WHERE id = $2::uuid AND org_id = $3::uuid",
                float(credit["credit_amount"]), body.bill_id, org_id,
            )
    return dict(row)


@router.patch("/sla-credits/{credit_id}/waive")
async def waive_sla_credit(
    credit_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_vendor_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE staging.vendor_sla_credits SET status = 'waived' "
        "WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'pending' "
        "RETURNING *",
        credit_id, org_id,
    )
    if not row:
        raise HTTPException(404, "SLA credit not found or not pending")
    return dict(row)


# ── P5.5: Payment Ageing ────────────────────────────────────────────────

def _ageing_bucket(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "current"
    if days_overdue <= 30:
        return "30"
    if days_overdue <= 60:
        return "60"
    if days_overdue <= 90:
        return "90"
    if days_overdue <= 120:
        return "120"
    return "120+"


@router.get("/ageing")
async def payment_ageing(
    direction: str = "receivable",
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if direction not in ("receivable", "payable"):
        raise HTTPException(400, "direction must be 'receivable' or 'payable'")
    pool = await get_pool()
    today = date.today()

    if direction == "receivable":
        rows = await pool.fetch(
            "SELECT i.id, i.total, i.amount_paid, i.due_date, "
            "       c.id AS party_id, c.name AS party_name "
            "FROM staging.ganit_invoices i "
            "JOIN staging.graha_clients c "
            "  ON c.id = i.client_id AND c.org_id = i.org_id "
            "WHERE i.org_id = $1::uuid AND i.payment_status != 'paid'",
            org_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT b.id, b.total, b.amount_paid, b.due_date, "
            "       v.id AS party_id, v.name AS party_name "
            "FROM staging.ganit_vendor_bills b "
            "JOIN staging.ganit_vendors v ON v.id = b.vendor_id "
            "WHERE b.org_id = $1::uuid AND b.status != 'paid'",
            org_id,
        )

    totals = {"current": 0.0, "30": 0.0, "60": 0.0, "90": 0.0, "120": 0.0, "120+": 0.0}
    by_client: dict[str, dict] = {}
    for r in rows:
        outstanding = float(r["total"] or 0) - float(r["amount_paid"] or 0)
        if outstanding <= 0:
            continue
        due = r["due_date"] or today
        days_overdue = (today - due).days
        bucket = _ageing_bucket(days_overdue)
        totals[bucket] += outstanding

        party_id = str(r["party_id"])
        entry = by_client.setdefault(party_id, {
            "party_id": party_id,
            "party_name": r["party_name"],
            "current": 0.0, "30": 0.0, "60": 0.0, "90": 0.0, "120": 0.0, "120+": 0.0,
            "total_outstanding": 0.0,
        })
        entry[bucket] += outstanding
        entry["total_outstanding"] += outstanding

    return {
        "direction": direction,
        "buckets": ["current", "30", "60", "90", "120", "120+"],
        "by_client": list(by_client.values()),
        "totals": totals,
    }


# ── P5.5: Sales Quota Proration ─────────────────────────────────────────

@router.get("/quota-proration")
async def quota_proration(
    target: float,
    start_date: str,
    end_date: str,
    join_date: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(require_any_module("ganit", "vikray")),
):
    try:
        period_start = date.fromisoformat(start_date)
        period_end = date.fromisoformat(end_date)
        joined = date.fromisoformat(join_date)
    except ValueError:
        raise HTTPException(400, "Dates must be ISO format (YYYY-MM-DD)")
    if period_end <= period_start:
        raise HTTPException(400, "end_date must be after start_date")

    # ONE DAY-COUNT CONVENTION, AND IT IS PAYROLL'S. Owner decision 0.17,
    # 2026-08-26: calendar minus Sundays, everywhere.
    #
    # This loop counted `weekday() < 5` — Monday to Friday — while
    # `routers/vetana.py` prorates a part-month on "every calendar day that is
    # not a Sunday". For August 2026 that is 21 days here against 26 there, so
    # the same absence was worth a different fraction depending on which engine
    # asked, and a quota true-up could not be reconciled against the payroll it
    # was meant to sit beside.
    #
    # Payroll is the one that keeps its convention, for the obvious reason: it
    # has money flowing through it and a six-day week is what Indian firms
    # actually work. Saturday is a working day here now.
    working_days_total = 0
    working_days_active = 0
    d = period_start
    while d < period_end:
        if d.weekday() != 6:          # 6 = Sunday
            working_days_total += 1
            if d >= joined:
                working_days_active += 1
        d += __import__("datetime").timedelta(days=1)

    ratio = (working_days_active / working_days_total) if working_days_total else 0.0
    prorated_target = round(target * ratio, 2)

    return {
        "full_target": target,
        "prorated_target": prorated_target,
        "ratio": round(ratio, 4),
        "working_days_total": working_days_total,
        "working_days_active": working_days_active,
    }
