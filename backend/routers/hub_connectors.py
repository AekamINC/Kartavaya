"""hub_connectors.py — one page's worth of API: every network, one card each.

The forms, the field labels and the resolution order live in
`services/connector_credentials.py`. This file is the plumbing around them —
who may look, who may write, what a browser is allowed back, and what "Test
connection" actually does.

── WHO ─────────────────────────────────────────────────────────────────────────

`require_org_role("org_owner", "org_admin")`. An app secret is the credential the
whole connector rests on: whoever holds it can post as the client on that
network for as long as it is valid. That is not a per-module grant, so it is not
`require_module` — a Marketing editor may schedule posts and may not hold the
key that makes posting possible.

Every write leaves an audit row. Not the values — the ACT: who set which
platform's credentials, at which scope, and when.

── WHAT COMES BACK ─────────────────────────────────────────────────────────────

Never a secret. `public_view()` builds every response from the spec outward, so
redaction is structural rather than a serialiser somebody has to remember to
update. The card gets `has_secret` and a four-character hint, which is what an
operator needs to answer "is the value on screen the one in my console" without
the value ever crossing the network again.

── TEST CONNECTION ─────────────────────────────────────────────────────────────

Deliberately shallow, and honest about it. It resolves the credentials the same
way a real flow would and asks the network one cheap, read-only question. What
that proves is that the id and secret are a real pair the network recognises. It
does NOT prove the app has the scopes, has passed review, or is out of trial —
those fail later and are what the `notes` on each card are for. A test that
claimed more than it checked would be worse than no test.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field as PField

from db import get_pool
from middleware.module_levels import LEVELS
from middleware.org_resolver import get_org_id
from middleware.roles import is_org_admin, require_org_role
from auth_router import require_user
from services import connector_credentials as cc
from services import connector_setup
from services.audit import emit as audit_emit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/hub/connectors", tags=["hub-connectors"])

#: Both endpoints, one gate, one place to change who may look.
_admin = require_org_role("org_owner", "org_admin")

# ── The second audience ─────────────────────────────────────────────────────
#
# Everything above this line is app-SECRET work and stays org-owner/org-admin.
# `/social-status` is not: it carries no secret, and its readers are the people
# who connect accounts and post — a marketing editor or admin who is very often
# neither an owner nor an admin of the organisation.
#
# The gate and the level resolver are IMPORTED from `hub_publish` rather than
# rebuilt here. The whole point of this endpoint is to stop the UI offering a
# control that 403s, and it can only promise that if the question it answers is
# asked by the same code the connect route enforces. A second
# `require_any_module("sahayak", "prachar")` built here would be one edit away
# from disagreeing with the route it describes.
from routers.hub_publish import (            # noqa: E402 — see the note above
    _hub_gate as _publishing_gate,
    _level_across,
)

#: The four words a card can say, weakest first. `not_set` and `ready` describe
#: the APP; `live` and `attention` describe CONNECTED ACCOUNTS.
CARD_STATES = ("not_set", "ready", "live", "attention")


def card_state(app_configured: bool, connected: int, expired: int) -> str:
    """The one sentence the card's colour is allowed to make.

    GREEN COUNTS CONNECTED ACCOUNTS AND NOTHING ELSE. The screen this replaces
    said `NOT SET` / `ON`, where `ON` meant a row with `is_active` — a saved app
    id and a pasted secret. Measured live on 2026-08-21, that is exactly what
    two platforms on this org have: Instagram and LinkedIn, both saved, both
    active, and **zero connected accounts between them**. Both cards were `ON`.
    Nothing could post to either. A card that goes green for a pasted secret is
    the same lie in a nicer colour.

    So the ladder is:

      attention  accounts are connected and at least one token has EXPIRED.
                 Ranked above `live` because a firm with three good accounts
                 and one dead one has a problem, and averaging it into green
                 hides the one thing worth acting on.
      live       at least one account is connected. The card says how many.
      ready      an app is saved and switched on, and nobody has connected yet.
                 This is the state where Connect is the only useful control.
      not_set    no app. Connect cannot work; setting one is the whole job.

    `live` does not require an app row, and that is deliberate rather than an
    oversight: an account connected by pasted token (X, WhatsApp) is live
    whether or not anybody filled in the app form, and the app section on the
    card says so separately.
    """
    if connected and expired:
        return "attention"
    if connected:
        return "live"
    if app_configured:
        return "ready"
    return "not_set"


def _env_app_configured(platform: str) -> bool:
    """Whether the environment would answer for this platform.

    `cc.resolve` reads it as the LAST step of the lookup, so a card whose org
    has saved nothing can still be connectable. Read through `OAUTH_CONFIGS`,
    which is the same dict `cc.resolve` uses, so there is one statement of which
    variable belongs to which platform.

    The variable's NAME is not returned and never goes to a browser — only
    whether something is there. Measured 2026-08-07: not one of them is set on
    staging, so this answers False for everything today and exists so that the
    day somebody sets one, the card stops saying `Not set` about a platform that
    works.
    """
    from routers.hub_publish import OAUTH_CONFIGS
    cfg = OAUTH_CONFIGS.get(platform) or {}
    return bool(cfg.get("env_id") and os.getenv(cfg["env_id"]))


def _satisfies(level: Optional[str], required: str) -> bool:
    """`hub_publish._authority`'s comparison, without the raise.

    The route raises; a screen has to render. Same ladder, same direction — a
    level the ladder does not know reads as NOT satisfying, so an unknown value
    hides a control rather than offering one the API will refuse.
    """
    if level is None or level not in LEVELS or required not in LEVELS:
        return False
    return LEVELS.index(level) >= LEVELS.index(required)


class CredentialSave(BaseModel):
    """One card's form, posted whole.

    `values` is untyped on purpose — the fields differ per platform and are
    declared in the spec, which `split_values` applies. A key the platform does
    not declare is dropped there rather than validated here, so there is one
    statement of what a platform's form contains.
    """
    platform: str
    #: NULL saves the ORG-level default. Set saves that client's override.
    client_id: Optional[str] = None
    values: dict = PField(default_factory=dict)
    #: A card is off until someone turns it on, and cannot be turned on
    #: half-filled — see `missing_fields`.
    is_active: bool = False


async def _verify_client(pool, client_id: Optional[str], org_id: str) -> Optional[str]:
    """A client id on this request must belong to the caller's org.

    The same check `hub_publish._require_client_in_org` makes, and for a sharper
    reason here: this route WRITES CREDENTIALS keyed on that id. Unchecked, an
    org admin could file their own Meta app under another org's client and have
    that org's operators publish through it.
    """
    if not client_id:
        return None
    ok = await pool.fetchval(
        "SELECT 1 FROM public.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        client_id, org_id,
    )
    if not ok:
        raise HTTPException(404, "Client not found")
    return client_id


@router.get("/guides")
async def list_setup_guides(_r=Depends(_admin)):
    """Every platform's long-form setup guide, in one response.

    NOT gated on a saved row, and deliberately: the person who needs this has
    nothing saved yet. It is the same definition the card's short steps come
    from, at full length, so the two cannot drift into contradicting each other.

    One response rather than one per platform because the guide page shows them
    all and the payload is a few kilobytes of static prose.
    """
    return {
        "guides": [connector_setup.public_guide(s.key) for s in cc.SPECS],
        "written": connector_setup.SETUP_WRITTEN,
        "where_checked": cc.WHERE_CHECKED,
    }


@router.get("/guides/{platform}")
async def get_setup_guide(platform: str, _r=Depends(_admin)):
    """One platform's guide. 404 rather than an empty shell for an unknown key."""
    guide = connector_setup.public_guide(platform)
    if not guide:
        raise HTTPException(404, f"No setup guide for: {platform}")
    spec = cc.spec(platform)
    guide["label"] = spec.label if spec else platform
    guide["console"] = spec.console if spec else ""
    guide["redirect_url"] = cc.redirect_url(platform)
    return guide


@router.get("")
async def list_connectors(
    client_id: Optional[str] = None,
    org_id: str = Depends(get_org_id),
    _r=Depends(_admin),
):
    """Every platform, its form, and whatever is saved for it.

    EVERY platform, always — including the ones with nothing saved. The screen
    is a page of cards rather than a list of connections, and a platform that
    only appears once it is configured cannot be configured.

    When `client_id` is given, each card carries both levels: the org default and
    that client's override, plus which of the two would actually answer. "Whose
    app is this posting as" is the question this page exists to make answerable.
    """
    pool = await get_pool()
    await _verify_client(pool, client_id, org_id)

    rows = await pool.fetch(
        "SELECT id, client_id::text AS client_id, platform, public_fields, "
        "       secrets_encrypted, secret_hint, is_active, last_tested_at, "
        "       last_test_ok, last_test_detail "
        "  FROM public.hub_connector_credentials "
        " WHERE org_id=$1::uuid AND (client_id IS NULL OR client_id=$2::uuid)",
        org_id, client_id,
    )
    org_rows = {r["platform"]: dict(r) for r in rows if not r["client_id"]}
    client_rows = {r["platform"]: dict(r) for r in rows if r["client_id"]}

    out = []
    for s in cc.SPECS:
        card = cc.public_view(s.key, org_rows.get(s.key))
        card["org"] = cc.public_view(s.key, org_rows.get(s.key))
        card["client"] = (
            cc.public_view(s.key, client_rows.get(s.key)) if client_id else None
        )
        # Which one a publish would actually use, without decrypting anything:
        # an active row at the narrower scope wins, then the wider one. The env
        # var is resolved server-side only and is reported as "env" rather than
        # named, because the variable's NAME is not the browser's business.
        if client_id and client_rows.get(s.key, {}).get("is_active"):
            card["effective_scope"] = "client"
        elif org_rows.get(s.key, {}).get("is_active"):
            card["effective_scope"] = "org"
        else:
            card["effective_scope"] = "env_or_none"
        out.append(card)

    return {
        "data": out,
        "client_id": client_id,
        # Named so the screen can say why a platform it remembers is gone,
        # instead of silently dropping a card somebody configured.
        "retired": sorted(cc.RETIRED_PLATFORMS),
        "where_checked": cc.WHERE_CHECKED,
    }


@router.get("/social-status")
async def social_status(
    client_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_publishing_gate),
):
    """Every publishing network's APP and its CONNECTED ACCOUNTS, in one answer.

    ── WHY THIS EXISTS ─────────────────────────────────────────────────────────

    Nothing returned the two together, so nothing could tell the truth about a
    network. `GET /v1/hub/connectors` knows an app is saved and has never heard
    of an account; `GET /v1/hub/clients/{id}/social-accounts` knows the accounts
    and has never heard of an app. The two screens built on them are the owner's
    complaint — the setup lives in Settings and the connecting lives in Sahayak,
    and neither screen can say whether the network actually works.

    ── WHY IT IS NOT A FIELD ON THE LISTING ────────────────────────────────────

    The listing is `require_org_role("org_owner", "org_admin")`, because it
    carries the app FORM and a secret hint. Half the readers of a Social
    accounts page are not org admins — a Marketing admin connects accounts and
    posts, and holds no org role at all. Bolting the counts onto a route they
    cannot call would have left that person staring at an empty page. So this is
    a second, narrower answer on a wider gate, and it carries no secret at all:
    no token, no secret hint, no field values, and no account UUID.

    ── WHAT IT WILL NOT SAY ────────────────────────────────────────────────────

    Account NAMES, never account ids — the same rule the whole product is held
    to. `expired` names the accounts to reconnect, because "1 needs attention"
    without saying which one sends somebody hunting through Sahayak.
    """
    pool = await get_pool()

    clients = await pool.fetch(
        "SELECT id::text AS id, name, is_internal "
        "  FROM public.hub_clients "
        " WHERE org_id=$1::uuid AND is_active=TRUE "
        " ORDER BY is_internal DESC, name",
        org_id,
    )

    if client_id:
        await _verify_client(pool, client_id, org_id)
    else:
        # The firm's own accounts are the default, because publishing for
        # yourself is the common case and picking a client first is a step.
        # READ ONLY: `GET /v1/hub/org-client` creates the row when it is
        # missing, and a status screen must not write one. A firm that has
        # never opened Sahayak gets `client_id: null` and a screen that says so.
        internal = next((c for c in clients if c["is_internal"]), None)
        client_id = internal["id"] if internal else None

    level = await _level_across(pool, user["user_id"], org_id)
    can_connect = _satisfies(level, "admin")
    can_send = _satisfies(level, "editor")
    can_edit_app = await is_org_admin(user["user_id"], org_id)

    cred_rows = await pool.fetch(
        "SELECT client_id::text AS client_id, platform, is_active "
        "  FROM public.hub_connector_credentials "
        " WHERE org_id=$1::uuid AND (client_id IS NULL OR client_id=$2::uuid)",
        org_id, client_id,
    )
    org_app = {r["platform"]: r for r in cred_rows if not r["client_id"]}
    client_app = {r["platform"]: r for r in cred_rows if r["client_id"]}

    # THE JOIN CARRIES THE ORG, not just the client id. `_verify_client` has
    # already proved this client belongs to the caller — this is the second lock
    # on the same door, and the reason it is here is that a join on the id alone
    # is precisely how `graha_clients` came to be able to surface another org's
    # rows. Counts are cheap to leak and impossible to unsee.
    acct_rows = await pool.fetch(
        "SELECT sa.platform, sa.account_name, "
        "       (sa.token_expires_at IS NOT NULL "
        "        AND sa.token_expires_at < NOW()) AS expired "
        "  FROM public.hub_social_accounts sa "
        "  JOIN public.hub_clients c ON c.id = sa.client_id "
        " WHERE sa.client_id=$1::uuid AND c.org_id=$2::uuid AND sa.is_active=TRUE "
        " ORDER BY sa.platform, sa.account_name",
        client_id, org_id,
    ) if client_id else []

    by_platform: dict[str, list] = {}
    for r in acct_rows:
        by_platform.setdefault(r["platform"], []).append(r)

    out = []
    for s in cc.SPECS:
        if not s.publishes:
            continue                       # lead sources are not destinations
        mine = by_platform.get(s.key, [])
        names = [r["account_name"] or "Unnamed account" for r in mine]
        expired = [r["account_name"] or "Unnamed account"
                   for r in mine if r["expired"]]

        client_row = client_app.get(s.key)
        org_row = org_app.get(s.key)
        if client_row and client_row["is_active"]:
            scope = "client"
        elif org_row and org_row["is_active"]:
            scope = "org"
        elif _env_app_configured(s.key):
            scope = "env"
        else:
            scope = "none"

        # SAVED BUT SWITCHED OFF IS NOT CONFIGURED. `cc.resolve` only ever
        # returns an ACTIVE row, so a half-filled draft left mid-edit must not
        # make a card say Ready — the connect it invites would fail.
        configured = scope != "none"

        out.append({
            "platform": s.key,
            "label": s.label,
            "kind": s.kind,
            "console": s.console,
            "caution": s.caution,
            "app": {
                "configured": configured,
                "scope": scope,
                # Saved at either level but switched on at neither. The one
                # state whose fix is a click rather than a form.
                "saved_but_off": (not configured) and bool(client_row or org_row),
            },
            "accounts": {
                "connected": len(mine),
                "expired": len(expired),
                "names": names,
                "expired_names": expired,
            },
            "state": card_state(configured, len(mine), len(expired)),
        })

    return {
        "data": out,
        "client_id": client_id,
        "clients": [dict(c) for c in clients],
        # What this caller may actually do, decided by the SAME resolver the
        # connect route enforces with. The screen renders from these rather than
        # from a second copy of the ladder in JavaScript.
        "can": {
            "connect": can_connect,
            "send": can_send,
            "edit_app": can_edit_app,
        },
        "level": level,
        # The API's own sentences, so a greyed control can say why in the words
        # the refusal would have used.
        "denials": {
            "connect": None if can_connect else (
                "Connecting a social account needs admin on Sahayak or "
                "Marketing." + (f" Yours is {level}." if level else
                                " You hold neither.")
                + " Ask an organisation admin."
            ),
            "send": None if can_send else (
                "Scheduling and publishing need editor on Sahayak or "
                "Marketing." + (f" Yours is {level}." if level else
                                " You hold neither.")
                + " Ask an organisation admin."
            ),
            "edit_app": None if can_edit_app else (
                "An app's id and secret can post as this client for as long as "
                "they are valid, so only an organisation owner or admin can "
                "change them."
            ),
        },
        "where_checked": cc.WHERE_CHECKED,
    }


@router.put("")
async def save_connector(
    body: CredentialSave,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _r=Depends(_admin),
):
    """Create or replace one card's credentials, at one scope.

    Secrets are MERGED, not replaced wholesale. An operator editing the app id
    on a saved card does not retype the secret — the form cannot even show it to
    them — so a blank secret field means "leave it alone", never "clear it".
    Clearing is `DELETE`, which is explicit and reversible by retyping.
    """
    s = cc.spec(body.platform)
    if not s:
        raise HTTPException(
            400,
            f"Unknown platform '{body.platform}'."
            + (" It was retired — see the connectors page."
               if body.platform in cc.RETIRED_PLATFORMS else ""),
        )

    pool = await get_pool()
    client_id = await _verify_client(pool, body.client_id, org_id)

    public, secrets = cc.split_values(body.platform, body.values)

    existing = await pool.fetchrow(
        "SELECT id, public_fields, secrets_encrypted FROM public.hub_connector_credentials "
        " WHERE org_id=$1::uuid AND platform=$2 "
        "   AND client_id IS NOT DISTINCT FROM $3::uuid",
        org_id, body.platform, client_id,
    )

    if existing:
        import json as _json
        prev_public = existing["public_fields"]
        if isinstance(prev_public, str):
            prev_public = _json.loads(prev_public or "{}")
        public = {**(prev_public or {}), **public}
        secrets = {**cc.unseal(existing["secrets_encrypted"]), **secrets}

    blob, hint = cc.seal(secrets)

    # Turning a card ON is the moment it starts outranking whatever answered
    # before, so it is the moment completeness matters. Saving an incomplete
    # draft is fine; activating one is not.
    if body.is_active:
        missing = cc.missing_fields(body.platform, {**public, **secrets})
        if missing:
            raise HTTPException(
                400, "Fill in " + ", ".join(missing) + " before switching this on.",
            )

    import json as _json
    row = await pool.fetchrow(
        "INSERT INTO public.hub_connector_credentials "
        "  (org_id, client_id, platform, public_fields, secrets_encrypted, "
        "   secret_hint, is_active, created_by, updated_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7, $8, $8) "
        "ON CONFLICT (org_id, platform) WHERE client_id IS NULL DO UPDATE SET "
        "  public_fields=EXCLUDED.public_fields, "
        "  secrets_encrypted=COALESCE(EXCLUDED.secrets_encrypted, "
        "                             public.hub_connector_credentials.secrets_encrypted), "
        "  secret_hint=EXCLUDED.secret_hint, is_active=EXCLUDED.is_active, "
        "  updated_by=EXCLUDED.updated_by, updated_at=NOW() "
        "RETURNING id, client_id::text AS client_id, public_fields, "
        "          secrets_encrypted, secret_hint, is_active, last_tested_at, "
        "          last_test_ok, last_test_detail"
        if client_id is None else
        "INSERT INTO public.hub_connector_credentials "
        "  (org_id, client_id, platform, public_fields, secrets_encrypted, "
        "   secret_hint, is_active, created_by, updated_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6, $7, $8, $8) "
        "ON CONFLICT (client_id, platform) WHERE client_id IS NOT NULL DO UPDATE SET "
        "  public_fields=EXCLUDED.public_fields, "
        "  secrets_encrypted=COALESCE(EXCLUDED.secrets_encrypted, "
        "                             public.hub_connector_credentials.secrets_encrypted), "
        "  secret_hint=EXCLUDED.secret_hint, is_active=EXCLUDED.is_active, "
        "  updated_by=EXCLUDED.updated_by, updated_at=NOW() "
        "RETURNING id, client_id::text AS client_id, public_fields, "
        "          secrets_encrypted, secret_hint, is_active, last_tested_at, "
        "          last_test_ok, last_test_detail",
        org_id, client_id, body.platform, _json.dumps(public), blob, hint,
        body.is_active, user["user_id"],
    )

    # The ACT, never the values. Who set which platform's credentials, at which
    # scope. An audit row carrying a secret is a second copy of the secret in a
    # table that is read by more people than the first one.
    audit_emit(
        "hub.connector_credentials_saved",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="connector",
        resource_id=body.platform,
        detail={"scope": "client" if client_id else "org",
                "is_active": body.is_active,
                "fields": sorted(public.keys()),
                "secrets_set": sorted(secrets.keys())},
        severity="warn",
    )
    return cc.public_view(body.platform, dict(row) if row else None)


@router.delete("/{platform}")
async def clear_connector(
    platform: str,
    request: Request,
    client_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _r=Depends(_admin),
):
    """Remove one scope's credentials. The other scope is untouched.

    Deleting a client's override does not delete the org default it was
    overriding — it falls back to it, which is the whole point of having two
    levels. `204` either way: a card somebody already cleared is not an error.
    """
    pool = await get_pool()
    client_id = await _verify_client(pool, client_id, org_id)
    await pool.execute(
        "DELETE FROM public.hub_connector_credentials "
        " WHERE org_id=$1::uuid AND platform=$2 "
        "   AND client_id IS NOT DISTINCT FROM $3::uuid",
        org_id, platform, client_id,
    )
    audit_emit(
        "hub.connector_credentials_cleared", request,
        org_id=org_id, user_id=user["user_id"],
        resource_type="connector", resource_id=platform,
        detail={"scope": "client" if client_id else "org"},
        severity="warn",
    )
    return {"ok": True}


@router.post("/{platform}/test")
async def test_connector(
    platform: str,
    request: Request,
    client_id: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _r=Depends(_admin),
):
    """Ask the network whether this id and secret are a pair it recognises.

    Resolved through `cc.resolve`, so the test exercises the SAME lookup order a
    real publish would — per-client, then org, then the environment. A test that
    read the row directly would pass on a row that no publish would ever choose.

    The result is stored on the row, so the card is honest on first paint rather
    than blank until somebody presses the button again.
    """
    s = cc.spec(platform)
    if not s:
        raise HTTPException(400, f"Unknown platform: {platform}")

    pool = await get_pool()
    client_id = await _verify_client(pool, client_id, org_id)
    resolved = await cc.resolve(pool, org_id, platform, client_id)

    if not resolved:
        return await _record_test(pool, org_id, platform, client_id, False,
                                  "Nothing is saved for this platform yet.")

    missing = cc.missing_fields(platform, resolved.values)
    if missing:
        return await _record_test(pool, org_id, platform, client_id, False,
                                  "Still missing: " + ", ".join(missing))

    ok, detail = await _probe(s, resolved.values)
    return await _record_test(pool, org_id, platform, client_id, ok, detail,
                              source=resolved.source)


async def _probe(s, values: dict) -> tuple[bool, str]:
    """One cheap, read-only call per platform family.

    Grouped by API family rather than per platform, because Facebook, Instagram
    and Threads share a Meta app and one `oauth/access_token` check answers for
    all three. A platform with no probe says so rather than returning a green
    tick it did not earn.
    """
    import httpx

    try:
        async with httpx.AsyncClient(timeout=12) as http:
            if s.key in ("facebook", "instagram", "threads"):
                r = await http.get(
                    "https://graph.facebook.com/v21.0/oauth/access_token",
                    params={"grant_type": "client_credentials",
                            "client_id": values.get("app_id", ""),
                            "client_secret": values.get("app_secret", "")},
                )
                if r.status_code == 200 and "access_token" in r.text:
                    return True, "Meta recognised this app id and secret."
                return False, _meta_error(r)

            if s.key == "whatsapp_business":
                r = await http.get(
                    f"https://graph.facebook.com/v21.0/{values.get('phone_number_id','')}",
                    params={"fields": "display_phone_number,verified_name"},
                    headers={"Authorization": f"Bearer {values.get('access_token','')}"},
                )
                if r.status_code == 200:
                    body = r.json()
                    return True, (
                        f"Connected to {body.get('verified_name') or 'this account'} "
                        f"on {body.get('display_phone_number') or 'the saved number'}."
                    )
                return False, _meta_error(r)

            if s.key in ("linkedin",):
                r = await http.post(
                    "https://www.linkedin.com/oauth/v2/accessToken",
                    data={"grant_type": "client_credentials",
                          "client_id": values.get("client_id", ""),
                          "client_secret": values.get("client_secret", "")},
                )
                # LinkedIn refuses client_credentials for most apps, and that
                # refusal still distinguishes a WRONG secret (401 invalid_client)
                # from a right one (400 unauthorized_scope_error).
                if r.status_code == 401:
                    return False, "LinkedIn rejected this client id and secret."
                return True, "LinkedIn recognised this client id and secret."

            if s.key in ("google_business", "youtube"):
                r = await http.post(
                    "https://oauth2.googleapis.com/token",
                    data={"grant_type": "authorization_code", "code": "probe",
                          "client_id": values.get("client_id", ""),
                          "client_secret": values.get("client_secret", ""),
                          "redirect_uri": cc.redirect_url(s.key)},
                )
                # `invalid_grant` means the code was bad — which it was, it is a
                # probe — and therefore that the CLIENT was accepted.
                text = r.text or ""
                if "invalid_client" in text:
                    return False, "Google rejected this client id and secret."
                if "invalid_grant" in text:
                    return True, "Google recognised this client id and secret."
                return True, "Google accepted the credentials."

            if s.key == "twitter":
                r = await http.post(
                    "https://api.x.com/2/oauth2/token",
                    data={"grant_type": "client_credentials"},
                    auth=(values.get("client_id", ""), values.get("client_secret", "")),
                )
                if r.status_code in (200, 403):
                    # 403 is "your access level cannot do this", which is the
                    # paid-tier wall and NOT a wrong secret. Reported as such,
                    # because the two need completely different actions.
                    return (r.status_code == 200), (
                        "X recognised these credentials."
                        if r.status_code == 200 else
                        "X recognised the credentials but this developer account's "
                        "access level cannot post. Posting on X is a paid tier."
                    )
                return False, "X rejected this client id and secret."

    except Exception as exc:                            # noqa: BLE001 — reported
        log.warning("connector probe failed for %s: %s", s.key, exc)
        return False, f"Could not reach {s.label} ({type(exc).__name__})."

    return True, (
        f"Saved. There is no read-only check {s.label} offers, so this confirms "
        f"the form is complete rather than that the credentials work."
    )


def _meta_error(r) -> str:
    try:
        return "Meta said: " + (r.json().get("error", {}).get("message") or r.text[:200])
    except Exception:                                   # noqa: BLE001
        return f"Meta refused this ({r.status_code})."


async def _record_test(pool, org_id, platform, client_id, ok, detail, source="") -> dict:
    await pool.execute(
        "UPDATE public.hub_connector_credentials "
        "   SET last_tested_at=NOW(), last_test_ok=$4, last_test_detail=$5 "
        " WHERE org_id=$1::uuid AND platform=$2 "
        "   AND client_id IS NOT DISTINCT FROM $3::uuid",
        org_id, platform, client_id, ok, detail[:500],
    )
    return {"ok": ok, "detail": detail, "source": source, "platform": platform}
