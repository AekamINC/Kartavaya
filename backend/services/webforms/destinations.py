"""Where a public web-form submission lands.

── WHY THIS EXISTS ───────────────────────────────────────────────────────────

`graha_web_forms` was already module-agnostic in every respect but one: it
carries a name, a slug, free-form `fields` jsonb and a settings blob, and none
of that is CRM-specific. The coupling lived entirely in the submit handler,
which creates a `graha_contacts` row and can create nothing else. So a firm
could publish a lead form and nothing else — no job application, no vendor
enquiry — from a table that would happily hold any of them.

── THE ALLOWLIST IS THIS DICT ────────────────────────────────────────────────

`DESTINATIONS` is the server-side allowlist CLAUDE.md's SQL rule describes,
applied to a routing decision rather than to an identifier: the stored value is
LOOKED UP here and never interpolated anywhere. Migration 251 puts the same set
in a CHECK constraint, so a destination the code cannot handle also cannot be
stored, and neither half can drift without the other failing loudly.

⚠ THE CRM HANDLER IS DELIBERATELY NOT IN THIS FILE. It stays exactly where it
is, inline in `routers/graha.py`. That path had never once worked until
2026-08-31 — an `ON CONFLICT` against an index that did not exist — and it now
carries 24 real submissions typed through a browser. Moving 140 lines of it to
prove a point about symmetry would put the only proven public write in this
product back into the state it just came out of. `submit_web_form` dispatches
AROUND it instead: a non-CRM destination takes this module, and the CRM
destination reaches code that has not moved a line.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import HTTPException


async def _module_is_active(conn, org_id: str, module_code: str) -> bool:
    """Whether the org actually holds a module.

    `require_module()` is the normal gate and it CANNOT be used here: it
    resolves the module from an authenticated user, and this request has none
    by design. So the subscription is asked for directly. Without this check a
    firm that never bought the HR module could still have candidates written
    into it by anybody holding a slug.
    """
    row = await conn.fetchrow(
        "SELECT 1 FROM public.module_subscriptions "
        " WHERE org_id=$1::uuid AND module_code=$2 AND is_active=TRUE",
        org_id, module_code,
    )
    return row is not None


async def land_hr_application(
    conn, *, org_id: str, form: dict, payload: dict,
) -> tuple[str, Optional[str]]:
    """A submission becomes a candidate against one job opening.

    Returns `(column_name, row_id)` so the caller can store the link in the
    right nullable foreign key on `graha_web_form_submissions`.

    ⚠ THE JOB OPENING COMES FROM THE FORM, NEVER FROM THE PAYLOAD.
    This is the same rule the CRM handler already applies to `client_id`, and it
    is the whole security story of this file. If the opening were read from the
    submitted body, anybody holding any slug could post an application into any
    opening in any organisation — the id is a uuid, but a uuid in a public
    payload is a parameter, not a secret. Reading it from the form the slug
    resolved to means the caller can only ever reach what that form points at.
    """
    settings = form.get("settings") or {}
    if isinstance(settings, str):
        try:
            settings = json.loads(settings)
        except (ValueError, TypeError):
            settings = {}

    opening_id = str(settings.get("job_opening_id") or "").strip()
    if not opening_id:
        # A misconfigured form, not a bad submission. The applicant is told
        # something neutral; the detail is for the firm, not the stranger.
        raise HTTPException(400, "This form is not accepting applications yet.")

    # Belt and braces on top of reading it from the form: the opening must be
    # THIS org's and must still be open. `manav.py` applies the same pair when
    # an authenticated recruiter files a candidate, and a public write has no
    # business being held to a looser standard than a signed-in one.
    opening = await conn.fetchrow(
        "SELECT id FROM public.manav_job_openings "
        " WHERE id=$1::uuid AND org_id=$2::uuid AND status='open'",
        opening_id, org_id,
    )
    if not opening:
        raise HTTPException(400, "This role is no longer accepting applications.")

    if not await _module_is_active(conn, org_id, "manav"):
        raise HTTPException(400, "This form is not accepting applications yet.")

    full_name = str(payload.get("name", "")).strip()[:200]
    if not full_name:
        # `manav_candidates.full_name` is NOT NULL. Refusing here names the
        # field; letting it reach the INSERT would be a 500 with no message,
        # which is the shape this codebase keeps finding.
        raise HTTPException(400, "Please give your name.")

    row = await conn.fetchrow(
        "INSERT INTO public.manav_candidates "
        "(org_id, job_opening_id, full_name, email, phone, stage, notes) "
        "VALUES ($1::uuid, $2::uuid, $3, NULLIF($4,''), NULLIF($5,''), 'applied', $6) "
        "RETURNING id",
        org_id, opening_id, full_name,
        str(payload.get("email", "")).strip()[:200],
        str(payload.get("phone", "")).strip()[:20],
        str(payload.get("message", "")).strip()[:2000],
    )
    return "candidate_id", str(row["id"])


#: destination -> handler. The database's CHECK constraint holds the same set.
#: A key added here without the migration cannot be stored; a value added to the
#: constraint without a handler here fails at dispatch. Both directions loud.
DESTINATIONS: dict[str, Any] = {
    # 'crm_contact' is intentionally absent as a callable — see the module
    # docstring. `submit_web_form` handles it inline, where it already works.
    "hr_application": land_hr_application,
}


def handler_for(destination: str):
    """The handler for a destination, or None when the caller owns it inline.

    Raises for a destination that is neither — which can only happen if the
    CHECK constraint and this module have drifted, and is exactly the case that
    must not fall through to "do the CRM thing by default".
    """
    if destination == "crm_contact":
        return None
    try:
        return DESTINATIONS[destination]
    except KeyError:
        raise HTTPException(500, "This form is misconfigured and cannot accept submissions.")


#: Everything a form's `destination` may be set to, including the one the
#: router owns inline. Migration 251's CHECK constraint holds the same set.
#:
#: ⚠ THIS EXISTS BECAUSE `destination` WAS UNREACHABLE. Migration 251 added the
#: column and `submit_web_form` dispatched on it from the day it shipped, but
#: `WebFormCreate` never carried the field — so every form this product could
#: create took the DEFAULT, and a live count on 2026-09-01 proves it: two forms,
#: both `crm_contact`, 24 submissions between them, zero of anything else. The
#: handler above was written, reviewed and tested against a value no customer
#: could ever store. Engine-supported and UI-unreachable is its own fault class
#: and it does not announce itself: nothing errors, the feature is simply not
#: there.
ALLOWED_DESTINATIONS: frozenset[str] = frozenset({"crm_contact"}) | frozenset(DESTINATIONS)


def validate_destination(destination: str, settings: dict) -> None:
    """Refuse a destination the code cannot serve, at CREATE rather than at submit.

    Two separate checks, and the second is the one that matters to a customer.

    The destination itself is checked against the allowlist — the SQL rule
    applied to a routing decision, and the same set the CHECK constraint holds,
    so a value that passes here cannot be refused by the database and a value
    the database would take cannot bypass this.

    Then the settings each destination REQUIRES. `land_hr_application` refuses a
    form with no `job_opening_id` with "This form is not accepting applications
    yet." — correct at submit time, but by then a firm has published a slug, put
    it on their careers page, and the first person to fill it in is the one who
    finds out. Checking at create means the firm finds out instead, on the
    screen that can fix it, which is the same argument `validate_tds_challan`
    makes about naming the field and the screen rather than failing late.
    """
    if destination not in ALLOWED_DESTINATIONS:
        raise HTTPException(
            400,
            "Choose where this form should send its submissions: "
            + ", ".join(sorted(ALLOWED_DESTINATIONS)),
        )
    if destination == "hr_application" and not str(
        (settings or {}).get("job_opening_id") or ""
    ).strip():
        raise HTTPException(
            400,
            "Pick the job opening this form applies to before publishing it.",
        )
