"""
hub_publish.py — Sahayak P4: Social Publishing Router
Connect social accounts via OAuth, schedule content, publish to platforms.
"""
import json
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, model_validator

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.role_tiers import OPERATIONS_CONSOLE_ROLES, ORG_MANAGEMENT_ROLES
from middleware.module_levels import LEVELS, _org_role, _platform_role, held_level
from middleware.subscription import require_any_module, require_module
from services.encryption import encrypt
from services.social_publisher import publish_content, process_scheduled_posts

router = APIRouter(prefix="/api/v1/hub", tags=["hub-publish"])

# PUBLISHING IS NOT AI, AND WAS SOLD AS IF IT WERE.
#
# Nothing in connect, schedule or publish runs a model. A firm that wants to
# post to its own Instagram, written by a human, had to buy an AI assistant to
# do it — and `hub_connectors.py`'s own header already imagines the reader as
# "a Marketing editor [who] may schedule posts", which is a Prachar person, not
# a Sahayak one.
#
# So the gate admits either. Generating the post with a model stays Sahayak's;
# connecting an account and sending are marketing work and are gated as such.
_hub_gate = require_any_module(
    "sahayak", "prachar", subject="connected accounts and publishing",
)
log = logging.getLogger(__name__)


async def _level_across(pool, user_id: str, org_id: str) -> str | None:
    """The STRONGEST level this caller holds on either publishing module.

    `_hub_gate` admits a holder of sahayak OR prachar, so the authority question
    has to be asked of both — a Prachar admin who holds no Sahayak grant is
    exactly the person this change exists to admit, and asking only Sahayak
    would let them through the door and refuse them at the desk.
    """
    levels = []
    for code in ("sahayak", "prachar"):
        lv = await held_level(pool, user_id, org_id, code)
        if lv:
            levels.append(lv)
    if not levels:
        return None
    return max(levels, key=lambda lv: LEVELS.index(lv) if lv in LEVELS else -1)


async def _aekam_has_a_live_session(pool, user_id: str, org_id: str) -> bool:
    """Is this Aekam operator inside an approved, unexpired support session here?

    Reads `staging.v_active_support_sessions`, whose own COMMENT says: "THE
    authorisation predicate for platform support access. Read this; never
    rebuild the four clauses at a call site. Drift in a re-derived predicate is
    always permissive, because the clause a reader forgets is one that excludes
    rows." So the four clauses — approved, not denied, not revoked, not expired —
    are the view's and are not repeated here.

    Two narrowings on top of it, both deliberate:

      · `requested_by = this operator`. A session is granted to a PERSON, by
        name, in an email the customer read. Letting a second operator ride
        somebody else's approval would make that name decorative.
      · the module must be in the session's `modules`. A customer who approved
        access to Ganit did not approve posting to their Instagram.

    FAILS CLOSED. If the view is missing the answer is False, which refuses
    Aekam — the opposite of the fail-open direction used elsewhere in this file,
    and correct here: everywhere else a failure costs a customer their own
    feature, and here it costs Aekam a power the customer never granted.
    """
    try:
        row = await pool.fetchrow(
            "SELECT modules FROM public.v_active_support_sessions "
            "WHERE org_id = $1::uuid AND requested_by = $2 "
            "ORDER BY approved_at DESC LIMIT 1",
            org_id, user_id,
        )
    except Exception:
        log.warning(
            "support-session check failed for %s in org %s — refusing platform "
            "access to publishing", user_id, org_id, exc_info=True,
        )
        return False
    if not row:
        return False
    covered = set(row["modules"] or ())
    return bool(covered & {"sahayak", "prachar"})


def _authority(required: str, act: str):
    """Build the dependency for one rung of the publishing ladder.

    TWO RUNGS, and the split is what somebody can undo.

      editor  SENDS. Scheduling and publish-now put words in front of a real
              audience under the client's name and cannot be recalled — but
              they change no configuration, and `subscription.py` already
              defines editor on prachar/varta/sanvaad as exactly "does not
              change a record, it SENDS". A marketing editor doing marketing.

      admin   CONNECTS. Connecting writes a live credential, disconnecting
              silently stops a firm's publishing, and setting a client's
              platforms decides what is possible at all. These outlive any
              single post.

    WHAT THIS REPLACES, and why it was wrong. The previous check fell back to
    the org role — owner or admin — on the stated grounds that
    "`org_member_modules` has no `role` column yet (PROPOSED_065, not applied)".
    MEASURED 2026-08-21: the column exists and is populated — 52 grants, of
    which admin 21, viewer 23, approver 5, editor 3. The comment was stale, and
    a stale comment had narrowed the product to org admins for months. There is
    nothing to wait for; `held_level` reads that column today.
    """
    async def _gate(
        user=Depends(require_user),
        org_id: str = Depends(get_org_id),
    ):
        pool = await get_pool()

        # AEKAM DOES NOT GET THIS BY STANDING.
        #
        # `held_level` returns "admin" for platform staff on any module they can
        # reach — a product-wide rule that is right for reading a customer's
        # screen and wrong for this. Ten accounts held it, and it let any of
        # them connect a customer's Instagram, disconnect it, or publish to
        # that customer's followers under that customer's name, unrecallably,
        # with nothing granted and nothing recorded.
        #
        # The owner's answer, asked and given: it requires a support session.
        # That mechanism already exists — customer-approved, time-boxed,
        # audited, and now requestable by the firm itself.
        #
        # Ordered BEFORE the level lookup so the refusal cannot depend on
        # anything about this org's grants, and org owners and admins are never
        # asked: this narrows Aekam only.
        platform_role = await _platform_role(pool, user["user_id"])
        if platform_role and not await _org_role(pool, user["user_id"], org_id):
            if not await _aekam_has_a_live_session(pool, user["user_id"], org_id):
                raise HTTPException(
                    403,
                    f"{act} in a customer's organisation needs an approved "
                    f"support session. Raise one and ask the customer to "
                    f"approve it; it expires on its own.",
                )

        level = await _level_across(pool, user["user_id"], org_id)
        if level is None:
            raise HTTPException(
                403,
                f"{act} needs a Sahayak or Marketing grant. Ask an "
                f"organisation admin.",
            )
        if LEVELS.index(level) < LEVELS.index(required):
            raise HTTPException(
                403,
                f"{act} needs {required} on Sahayak or Marketing. Yours is "
                f"{level}. Ask an organisation admin to raise it.",
            )
        return user

    return _gate


#: SENDS — schedule, bulk-schedule, publish now.
_require_send_authority = _authority("editor", "Publishing a post")

#: CONFIGURES — connect, disconnect, decide a client's platforms.
_require_connect_authority = _authority("admin", "Connecting a social account")

#: Kept so nothing importing the old name breaks; it is the stricter of the two,
#: which is the safe direction for any caller this file does not know about.
_require_publish_authority = _require_connect_authority


async def _store_oauth_state(state: str, data: dict):
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO public.hub_oauth_states (state, data) VALUES ($1, $2::jsonb) "
        "ON CONFLICT (state) DO UPDATE SET data=$2::jsonb, created_at=NOW()",
        state, json.dumps(data),
    )

async def _require_client_in_org(pool, client_id: str, org_id: str):
    """Every `/clients/{client_id}/…` route must prove the client belongs to the
    caller's org before touching anything keyed on `client_id`.

    Half the routes in this file did this inline and half did not, so a member
    of any org holding a Sahayak grant could read another org's connected social
    accounts, their scheduled posts and their content calendar — and, through
    bulk-schedule, queue a post to another org's account. Nothing about the
    request had to be forged: the id was simply never checked.
    """
    ok = await pool.fetchval(
        "SELECT 1 FROM public.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        client_id, org_id,
    )
    if not ok:
        raise HTTPException(404, "Client not found")


async def _pop_oauth_state(state: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "DELETE FROM public.hub_oauth_states "
        "WHERE state=$1 AND created_at > NOW() - INTERVAL '10 minutes' "
        "RETURNING data",
        state,
    )
    return json.loads(row["data"]) if row else None

# DERIVED, 2026-08-07, from `services/connector_credentials.SPECS`. It used to
# be a hand-written list, and the two things wrong with that both bit:
#
#   · `twitter` was on it with no entry in OAUTH_CONFIGS below, so every attempt
#     to connect X answered `400 Unsupported platform` — a platform the product
#     offered and could not deliver.
#   · `tiktok`, `telegram` and `snapchat` were on it after the owner retired
#     them (TikTok is banned in India; the other two were unconnectable).
#
# One list, one place. A platform with a credentials card is a platform you can
# publish to, and a platform with neither is not offered at all. The lead
# sources — JustDial, IndiaMART — declare `publishes=False` and are therefore
# absent from this list on purpose: they are inbound, and offering them as a
# publish destination would be offering something that cannot work.
from services.connector_credentials import PUBLISH_PLATFORMS as _PUB

ALL_PLATFORMS = list(_PUB)

OAUTH_CONFIGS = {
    "facebook": {
        "auth_url": "https://www.facebook.com/v21.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v21.0/oauth/access_token",
        "scopes": "pages_manage_posts,pages_read_engagement,pages_show_list,instagram_basic,instagram_content_publish,ads_read",
        "env_id": "META_APP_ID",
        "env_secret": "META_APP_SECRET",
    },
    "instagram": {
        "auth_url": "https://www.facebook.com/v21.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v21.0/oauth/access_token",
        "scopes": "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,ads_read",
        "env_id": "META_APP_ID",
        "env_secret": "META_APP_SECRET",
    },
    "linkedin": {
        "auth_url": "https://www.linkedin.com/oauth/v2/authorization",
        "token_url": "https://www.linkedin.com/oauth/v2/accessToken",
        "scopes": "openid profile w_member_social",
        "env_id": "LINKEDIN_CLIENT_ID",
        "env_secret": "LINKEDIN_CLIENT_SECRET",
    },
    "google_business": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": "https://www.googleapis.com/auth/business.manage",
        "env_id": "GOOGLE_CLIENT_ID",
        "env_secret": "GOOGLE_CLIENT_SECRET",
    },
    "youtube": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube",
        "env_id": "GOOGLE_CLIENT_ID",
        "env_secret": "GOOGLE_CLIENT_SECRET",
    },
    "pinterest": {
        "auth_url": "https://www.pinterest.com/oauth/",
        "token_url": "https://api.pinterest.com/v5/oauth/token",
        "scopes": "boards:read,pins:read,pins:write",
        "env_id": "PINTEREST_APP_ID",
        "env_secret": "PINTEREST_APP_SECRET",
    },
    "threads": {
        "auth_url": "https://threads.net/oauth/authorize",
        "token_url": "https://graph.threads.net/oauth/access_token",
        "scopes": "threads_basic,threads_content_publish",
        "env_id": "META_APP_ID",
        "env_secret": "META_APP_SECRET",
    },
    # X (Twitter). Added 2026-08-07 — `twitter` was in ALL_PLATFORMS and had no
    # entry here, so `oauth_authorize` answered `400 Unsupported platform` for a
    # network the product listed. OAuth 2.0 with PKCE; `offline.access` is what
    # makes the refresh token appear, without which every account has to be
    # reconnected in two hours.
    #
    # POSTING IS A PAID TIER. The free access level cannot create posts, so a
    # correctly configured app here will still fail at publish time until the
    # developer account is on a paid plan. Surfaced on the card rather than
    # buried: services/connector_credentials.py, the `twitter` spec's `caution`.
    "twitter": {
        "auth_url": "https://x.com/i/oauth2/authorize",
        "token_url": "https://api.x.com/2/oauth2/token",
        "scopes": "tweet.read tweet.write users.read offline.access",
        "env_id": "TWITTER_CLIENT_ID",
        "env_secret": "TWITTER_CLIENT_SECRET",
    },
    "reddit": {
        "auth_url": "https://www.reddit.com/api/v1/authorize",
        "token_url": "https://www.reddit.com/api/v1/access_token",
        "scopes": "submit,read,identity",
        "env_id": "REDDIT_CLIENT_ID",
        "env_secret": "REDDIT_CLIENT_SECRET",
    },
}


# ── Destinations: WE ASK, WE DO NOT GUESS ───────────────────────────────────
#
# THE DEFECT THIS REPLACES. `_fetch_meta_accounts` did `page = page_list[0]` and
# `_fetch_google_locations` did `accounts[0]` then `locations[0]`. A firm
# administering three Pages got whichever Facebook happened to return first, was
# never asked, and was never told. `_fetch_linkedin_profile` was worse: it stored
# `sub` from /v2/userinfo, so every post a firm made landed on the personal feed
# of whichever partner happened to click Connect.
#
# THE OWNER'S RULE, given 2026-08-21 when asked whether LinkedIn should post as a
# person or a Company Page: "any connectors can do both. depends on org — someone
# org is sole business owner who is its own page." And on the picker: "also
# option to have multiple for all connectors ... as a company can have multiple
# account across social media."
#
# So there is one question, asked of every network, with more than one allowed
# answer: **post as…?** A sole trader picks themselves. A firm picks its page. An
# agency picks several. Each chosen destination becomes its own row and is posted
# to independently.
#
# WHAT A DESTINATION IS, per network. The picker names the kind beside the name
# because "Aekam Inc" alone does not tell anybody whether they are about to post
# to a personal timeline or a company page.
DESTINATION_KINDS = {
    "person": "your personal profile",
    "facebook_page": "Company Page",
    "instagram_business": "Instagram business account",
    "linkedin_organization": "Company Page",
    "google_location": "Google Business location",
    "youtube_channel": "YouTube channel",
    "pinterest_board": "Pinterest board",
    "account": "the account that gave consent",
}

#: How long a consent may sit unresolved before its tokens are forgotten.
#:
#: `_pop_oauth_state` gives the round-trip to the provider ten minutes, which is
#: right for a redirect nobody is reading. This one is a HUMAN reading a list of
#: their own Pages and deciding, possibly after asking a colleague which one the
#: firm actually posts from. Ten minutes turns that into a re-consent; thirty
#: covers it without keeping live tokens around for an afternoon.
PENDING_CHOICE_MINUTES = 30

#: The marker that tells a `hub_oauth_states` row apart from an in-flight OAuth
#: state. Both live in that table on purpose — see `_store_pending_choice`.
PENDING_KIND = "destination_choice"


def _scope_list(raw: str) -> list[str]:
    """Split a scope string however THAT network happens to delimit them.

    `config["scopes"].split(",")` was applied to every platform, and LinkedIn
    and Google delimit with spaces — so `scopes` was stored as a single array
    element reading `openid profile w_member_social`. Nothing reads the column
    yet, which is the only reason it never surfaced; a reconnect prompt that
    asks "did this account grant instagram_content_publish" would have read a
    sentence and answered no.
    """
    return [s for s in re.split(r"[,\s]+", (raw or "").strip()) if s]


def _linkedin_wants_organizations() -> bool:
    """Is this deployment's LinkedIn app allowed to see Company Pages?

    IT IS NOT A SETTING WE CONTROL. Listing the organisations somebody
    administers needs `r_organization_admin`, and posting as one needs
    `w_organization_social`; both belong to LinkedIn's **Community Management
    API**, which is an approved product on the app, not a checkbox. An app
    without that grant that ASKS for those scopes does not degrade — LinkedIn
    refuses the authorization request outright with `unauthorized_scope_error`,
    so the person never reaches consent and Connect simply breaks.

    That is why this is opt-in rather than always-on: switching it on for an app
    that has not been approved would take LinkedIn from "posts to the wrong
    place" to "cannot connect at all", which is a worse failure. Set
    `LINKEDIN_COMMUNITY_MANAGEMENT=1` once LinkedIn approves the product; until
    then the picker says, in the person's own screen, that Company Pages are
    unavailable and why.
    """
    return (os.getenv("LINKEDIN_COMMUNITY_MANAGEMENT", "") or "").strip().lower() \
        in ("1", "true", "yes", "on")


#: The scopes LinkedIn's Community Management API grants, and nothing else asks
#: for. `r_organization_admin` lists the organisations this member administers;
#: `w_organization_social` is what makes a post AS one of them possible.
LINKEDIN_ORG_SCOPES = "r_organization_admin w_organization_social"


def _scopes_for(platform: str, config: dict) -> str:
    """The scope string to send to THIS network at THIS moment.

    Only LinkedIn is dynamic, and only because its Company Page scopes are an
    entitlement rather than a choice. Everything else returns its configured
    string unchanged.
    """
    scopes = config["scopes"]
    if platform == "linkedin" and _linkedin_wants_organizations():
        return f"{scopes} {LINKEDIN_ORG_SCOPES}"
    return scopes


def _public_destination(index: int, dest: dict) -> dict:
    """What the BROWSER is allowed to see about one destination.

    A NAME and what it IS. Never the token — this is the whole reason the list
    goes back to the browser at all rather than being stored, and handing the
    page a Page token on the way past would defeat it. Never the destination's
    own id either: the product rule is names, not ids, so the browser chooses by
    an opaque positional key that means nothing off this row.
    """
    return {
        "key": f"d{index}",
        "name": dest.get("name") or "Unnamed",
        "kind": dest.get("kind") or "account",
        "what": DESTINATION_KINDS.get(dest.get("kind") or "account", "account"),
    }


async def _store_pending_choice(token: str, payload: dict):
    """Park a completed consent until a human says where it should post.

    WHY `hub_oauth_states` AND NOT A NEW TABLE. The intermediate step needs
    exactly what that table already is: an opaque unguessable key, a jsonb body,
    a `created_at` to expire on, and no relationship to any customer record. It
    is the OAuth scratchpad, it already carries this same client_id and org_id
    for this same round-trip, and a row in it is keyed on NOTHING — so parking
    here keeps the promise that matters: **nothing is written against a client
    until a destination is chosen.** A new table would have needed migration 188
    applied before the connect path worked at all, and this repository ships code
    ahead of its migrations (186 and 187 are both written-and-not-applied), so
    the connect path would have 500'd in the gap.

    A signed cookie or a JWT was the alternative and is worse for one reason:
    the payload carries live OAuth tokens, and a token in a browser-held payload
    is a token that has left the server. These are encrypted at rest by
    `services.encryption.encrypt` before they go into the jsonb, the row is
    deleted the moment a choice is made, and it expires on its own if nobody
    ever chooses.
    """
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO public.hub_oauth_states (state, data) VALUES ($1, $2::jsonb) "
        "ON CONFLICT (state) DO UPDATE SET data=$2::jsonb, created_at=NOW()",
        token, json.dumps(payload),
    )


async def _read_pending_choice(token: str) -> dict | None:
    """Read a parked consent WITHOUT consuming it.

    Deliberately not `_pop_oauth_state`: a person who reloads the page, or opens
    it in a second tab, or picks two destinations and then wants a third, must
    not find their consent gone. The row is deleted when a choice is stored, and
    otherwise expires.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT data FROM public.hub_oauth_states "
        "WHERE state=$1 AND created_at > NOW() - ($2::int * INTERVAL '1 minute') "
        "LIMIT 1",
        token, PENDING_CHOICE_MINUTES,
    )
    if not row:
        return None
    data = json.loads(row["data"]) if isinstance(row["data"], str) else dict(row["data"])
    if data.get("kind") != PENDING_KIND:
        # An in-flight OAuth state is not a choice, and answering with one
        # would let the token from a live consent be read by its own state
        # string. Treated as absent.
        return None
    return data


async def _discard_pending_choice(token: str):
    """Forget a consent once its destinations are stored — tokens included."""
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM public.hub_oauth_states WHERE state=$1", token,
    )


# ── Pydantic Models ──────────────────────────────────────────

class SocialAccountConnect(BaseModel):
    """Either a pasted token, or a destination picked out of a parked consent.

    TWO SHAPES, ONE ROUTE, and that is on purpose. Finishing the picker is
    "connect a social account for this client" — the identical act, at the
    identical rung, that this route already performs; `test_social_access_matrix
    .py` classifies it under CONNECTS and the admin authority it carries is
    exactly the authority a picked destination needs. A second route would have
    been a second place for that rung to drift.

    The manual half is untouched: `platform` and `access_token` are still
    required when no `choice_token` is present, enforced below rather than by
    the field types, because the picker path has no token to send — the token
    never left the server.
    """
    platform: str = ""
    account_name: str = ""
    account_id: str = ""
    page_id: str = ""
    access_token: str = ""
    refresh_token: str = ""
    scopes: list[str] = []

    #: The handle the OAuth callback handed the browser. Opaque, single-use,
    #: expires in PENDING_CHOICE_MINUTES.
    choice_token: str = ""
    #: Which destinations, by their positional keys — `["d0", "d2"]`. MANY, and
    #: that is the owner's whole point: an agency picks several.
    destinations: list[str] = []

    @model_validator(mode="after")
    def _one_shape_or_the_other(self):
        if self.choice_token:
            if not self.destinations:
                raise ValueError(
                    "Choose at least one destination to post as."
                )
            return self
        if not self.platform:
            raise ValueError("platform is required")
        if not self.access_token:
            raise ValueError("access_token is required")
        if not self.account_id.strip():
            # THE DESTINATION IS THE KEY. `(client_id, platform, account_id)` is
            # what lets a client hold several accounts on one network, and an
            # empty account_id collapses every one of them onto a single row
            # that each new connection overwrites. Migration 188 refuses it at
            # the database; refusing it here makes the message a sentence rather
            # than a constraint violation. The form has always marked this field
            # required — this is the API agreeing with its own screen.
            raise ValueError(
                "account_id is required — it is the account's own id on the "
                "network, and it is what lets this client hold more than one."
            )
        return self

class SchedulePost(BaseModel):
    content_id: str
    social_account_id: str
    scheduled_for: datetime

class BulkSchedule(BaseModel):
    content_id: str
    account_ids: list[str]
    scheduled_for: datetime


# ── OAuth Flow ─────────────────────────────────────────────

@router.get("/oauth/{platform}/authorize")
async def oauth_authorize(
    platform: str,
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
    _auth=Depends(_require_connect_authority),
):
    """Generate OAuth authorization URL for a platform."""
    config = OAUTH_CONFIGS.get(platform)
    if not config:
        raise HTTPException(400, f"Unsupported platform: {platform}")

    # The client id decides WHOSE social account this token gets filed under, and
    # it arrives as an unvalidated query parameter. Every other
    # `/clients/{client_id}/…` route in this file proves ownership first; this one
    # did not, and it is the route that WRITES TOKENS.
    #
    # Without this check a member of any org holding a Sahayak grant could pass
    # another org's client id, complete consent with their own social account, and
    # have the callback file their Page token under that org's client — after
    # which the victim's operators schedule their customer's content straight to
    # the attacker's Page. The ON CONFLICT ... DO UPDATE in the callback makes it
    # worse: matching an existing (platform, account_id) OVERWRITES a live token.
    pool = await get_pool()
    await _require_client_in_org(pool, str(client_id), org_id)

    # WHOSE APP. Per-client, then the org's default, then the environment
    # variable this line used to read alone — `services/connector_credentials.
    # resolve`, and the env var stays last so nothing that works today breaks.
    #
    # Before this, one hard-coded variable per network meant the whole platform
    # was fixed to a single Meta app, a single LinkedIn app and so on; an agency
    # whose client has their own could not express it. Measured on staging
    # 2026-08-07: not one of those variables is set, so in practice this raised
    # 500 for every platform and no OAuth flow in the product could complete.
    from services import connector_credentials as cc
    creds = await cc.resolve(pool, org_id, platform, str(client_id))
    app_id = creds.values.get(cc._primary_public_key(cc.spec(platform)), "")
    if not app_id:
        raise HTTPException(
            400,
            f"No credentials are saved for {cc.spec(platform).label}. An org "
            f"owner or admin sets them on the Connectors page.",
        )

    backend_url = os.getenv("BACKEND_URL", "").rstrip("/")
    redirect_uri = f"{backend_url}/api/v1/hub/oauth/{platform}/callback"

    state = secrets.token_urlsafe(32)
    await _store_oauth_state(state, {
        "platform": platform,
        "client_id": str(client_id),
        "org_id": org_id,
        "user_id": user["user_id"],
    })

    # ASK AT CONSENT TIME FOR WHAT THE PICKER WILL NEED TO SHOW. A scope that
    # was not requested here cannot be recovered in the callback: the consent
    # screen is the only moment the person is asked, and LinkedIn's Company
    # Pages are invisible to a token that never carried `r_organization_admin`.
    scopes = _scopes_for(platform, config)

    if platform in ("facebook", "instagram"):
        params = {
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "scope": scopes,
            "state": state,
            "response_type": "code",
        }
    elif platform == "linkedin":
        params = {
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "scope": scopes,
            "state": state,
            "response_type": "code",
        }
    elif platform == "google_business":
        params = {
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "scope": scopes,
            "state": state,
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
        }
    else:
        # Every remaining configured platform — X, Threads, Pinterest, Reddit,
        # YouTube — takes the plain authorization-code shape. This used to be a
        # `raise`, which is why `twitter` answered "Unsupported platform" even
        # after its config existed: the config was only half the gate.
        params = {
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "scope": scopes,
            "state": state,
            "response_type": "code",
        }

    auth_url = f"{config['auth_url']}?{urlencode(params)}"
    return {"auth_url": auth_url, "state": state}


@router.get("/oauth/{platform}/callback")
async def oauth_callback(
    platform: str,
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
):
    """Handle OAuth callback — exchange code for tokens, store account."""
    import httpx

    state_data = await _pop_oauth_state(state)
    if not state_data or state_data["platform"] != platform:
        raise HTTPException(400, "Invalid or expired OAuth state")

    config = OAUTH_CONFIGS.get(platform)
    if not config:
        raise HTTPException(400, f"Unsupported platform: {platform}")

    # This route is unauthenticated by necessity — the provider redirects the
    # browser here and there is no bearer token on the request. Its ONLY proof of
    # who this is for is the state row, so the pairing recorded in that row is
    # re-proved here rather than assumed.
    #
    # `org_id` was written into the state at authorize time and then never read,
    # which meant the insert below was keyed on client_id alone. Re-checking costs
    # one query on a once-per-connection route and closes the window where the
    # client is deleted, or moved to another org, during the consent round-trip.
    pool = await get_pool()
    state_org_id = state_data.get("org_id")
    if not state_org_id:
        raise HTTPException(400, "Invalid or expired OAuth state")
    await _require_client_in_org(pool, state_data["client_id"], state_org_id)

    # The SAME resolution the authorize step used, through the org recorded in
    # the state row. Reading the environment here while authorize read a saved
    # row would exchange the code against a different app than the one the user
    # consented to, and the network's error for that says only "invalid client".
    from services import connector_credentials as cc
    creds = await cc.resolve(pool, state_org_id, platform, state_data["client_id"])
    _spec = cc.spec(platform)
    app_id = creds.values.get(cc._primary_public_key(_spec), "")
    app_secret = creds.values.get(cc._primary_secret_key(_spec), "")
    backend_url = os.getenv("BACKEND_URL", "").rstrip("/")
    redirect_uri = f"{backend_url}/api/v1/hub/oauth/{platform}/callback"

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            config["token_url"],
            data={
                "code": code,
                "client_id": app_id,
                "client_secret": app_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

    access_token = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token", "")
    expires_in = tokens.get("expires_in")

    from datetime import timedelta
    token_expires_at = None
    if expires_in:
        token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    # ── ASK, DO NOT GUESS ───────────────────────────────────────────────────
    #
    # This is where the router used to write a row. It took the first Page
    # Facebook returned, or the first Google location, or the consenting
    # partner's personal LinkedIn feed, filed it under the client, and redirected
    # to a page saying "connected" — and the firm found out which destination it
    # had picked when a post appeared somewhere nobody chose.
    #
    # Now the consent is enumerated and parked, and **NOTHING IS WRITTEN AGAINST
    # THE CLIENT.** `staging.hub_social_accounts` is not touched on this path at
    # all. The row appears when a human presses a button in the picker, which is
    # `connect_social_account` below, and never before.
    destinations = await _list_destinations(
        platform, access_token, refresh_token, token_expires_at,
        _scope_list(_scopes_for(platform, config)),
    )

    frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
    from fastapi.responses import RedirectResponse

    if not destinations:
        # NOTHING TO PARK. Storing a pending row here would keep live tokens
        # against a choice that cannot be made. The page says what the network
        # returned instead of leaving somebody clicking Connect again.
        return RedirectResponse(
            f"{frontend_url}/settings/social-accounts"
            f"?oauth=nodestination&platform={platform}"
        )

    choice_token = secrets.token_urlsafe(32)
    await _store_pending_choice(choice_token, {
        "kind": PENDING_KIND,
        "platform": platform,
        "client_id": state_data["client_id"],
        "org_id": state_org_id,
        "user_id": state_data["user_id"],
        "client_name": await _client_name(pool, state_data["client_id"]),
        "note": _destination_note(platform, destinations),
        "destinations": destinations,
    })

    # WHY THE SOCIAL ACCOUNTS PAGE AND NOT THE HUB TAB IT USED TO RETURN TO.
    # The picker lives on `/settings/social-accounts`, which is the page that
    # was built to hold an app and its accounts together, and finishing a
    # connection is the act that page exists for. Sending the browser to the
    # publish tab would land it on a screen with no way to answer the question
    # this redirect is asking. `?oauth=success` is deliberately NOT sent: nothing
    # has been connected yet, and saying so would be the same lie the first-Page
    # guess used to tell.
    return RedirectResponse(
        f"{frontend_url}/settings/social-accounts"
        f"?oauth=choose&choose={choice_token}&platform={platform}"
    )


async def _client_name(pool, client_id: str) -> str:
    """The client's NAME, for a sentence that would otherwise show an id.

    The picker may be reached with a different client selected on the page, and
    "this consent was for someone else" is only useful if it says who.
    """
    try:
        return await pool.fetchval(
            "SELECT name FROM public.hub_clients WHERE id=$1::uuid", client_id,
        ) or ""
    except Exception:
        log.warning("could not read client name for the picker", exc_info=True)
        return ""


def _destination_note(platform: str, destinations: list[dict]) -> str:
    """The honest sentence for what this network did NOT return.

    Written here rather than in the browser because the reason lives here: only
    the server knows whether the LinkedIn app holds the Community Management
    grant, and only the server saw what the network answered.
    """
    kinds = {d.get("kind") for d in destinations}
    if platform == "linkedin" and "linkedin_organization" not in kinds:
        if not _linkedin_wants_organizations():
            return (
                "Company Pages are not listed. LinkedIn only shows the Pages "
                "somebody administers to an app holding its Community "
                "Management API grant, which is an approval LinkedIn gives to "
                "the app — not a setting on this screen. Until it is granted, "
                "posting as a Page is impossible and only the personal profile "
                "below can receive a post."
            )
        return (
            "No Company Pages came back. The app asked for them, so either this "
            "LinkedIn member administers none, or LinkedIn declined the "
            "organisation scopes at consent."
        )
    if platform == "instagram":
        return (
            "Only Instagram business accounts linked to a Facebook Page can "
            "receive a post. A personal Instagram account cannot, and is not "
            "listed."
        )
    if platform == "facebook":
        return (
            "A personal Facebook timeline cannot be posted to through the API, "
            "so only Pages are listed."
        )
    return ""


async def _list_destinations(
    platform: str, access_token: str, refresh_token: str,
    token_expires_at, scopes: list[str],
) -> list[dict]:
    """EVERYTHING this consent can post to, in the order the network gave it.

    One entry per destination, each carrying its own token where the network
    issues one (a Facebook Page token is not the user token, and posting to the
    Page with the user token fails). The shape is internal — `_public_destination`
    decides what the browser sees, and a token is never in it.

    Per-destination keys, all of them required by the insert in
    `connect_social_account`:

        name              what a human calls it
        kind              a key of DESTINATION_KINDS
        account_id        THE DESTINATION'S OWN ID. The uniqueness key. This is
                          the single most important field in this file: it used
                          to hold the CONSENTING PERSON's id, which is why a
                          second Page overwrote the first — see migration 188.
        page_id           what the publisher reads (`page_id or account_id`)
        access_token      ALREADY ENCRYPTED
        refresh_token     ALREADY ENCRYPTED, or None
        token_expires_at  datetime or None
        metadata          recorded on the row: who consented, and what kind of
                          destination this is, which is how
                          `social_publisher.publish_to_linkedin` knows whether to
                          build a person urn or an organisation urn

    A NETWORK THAT FAILS TO ANSWER RETURNS NOTHING rather than raising. The
    callback turns an empty list into a sentence on the screen; an exception here
    would be a 500 on a redirect the person cannot retry without re-consenting.
    """
    def _wrap(name: str, kind: str, account_id: str, page_id: str = "",
              token: str | None = None, meta: dict | None = None) -> dict:
        return {
            "name": name,
            "kind": kind,
            "account_id": account_id,
            "page_id": page_id or account_id,
            # Encrypted HERE, once, on the way into the parked payload — not on
            # the way into the table. The row insert passes this through
            # untouched; encrypting twice would store a ciphertext of a
            # ciphertext and every publish would fail with a token the network
            # has never seen.
            "access_token": encrypt(token or access_token),
            "refresh_token": encrypt(refresh_token) if refresh_token else None,
            "token_expires_at": token_expires_at.isoformat() if token_expires_at else None,
            "scopes": scopes,
            "metadata": {"destination_kind": kind, **(meta or {})},
        }

    try:
        if platform in ("facebook", "instagram"):
            return await _list_meta_destinations(access_token, platform, _wrap)
        if platform == "linkedin":
            return await _list_linkedin_destinations(access_token, _wrap)
        if platform == "google_business":
            return await _list_google_destinations(access_token, _wrap)
        if platform == "youtube":
            return await _list_youtube_destinations(access_token, _wrap)
        if platform == "pinterest":
            return await _list_pinterest_destinations(access_token, _wrap)
        if platform == "twitter":
            return await _list_twitter_destinations(access_token, _wrap)
        if platform == "threads":
            return await _list_threads_destinations(access_token, _wrap)
        if platform == "reddit":
            return await _list_reddit_destinations(access_token, _wrap)
    except Exception:
        log.warning(
            "could not enumerate destinations for %s — the person will be told "
            "the network returned nothing rather than shown a 500", platform,
            exc_info=True,
        )
        return []
    return []


async def _list_meta_destinations(token: str, platform: str, wrap) -> list[dict]:
    """Every Page (facebook) or Instagram business account (instagram).

    NO PERSONAL PROFILE, and that is not an omission. Publishing to a personal
    Facebook timeline was removed from the Graph API with `publish_actions`, and
    a personal Instagram account cannot be published to at all — only a business
    account linked to a Page. Offering either as a destination would be offering
    something that cannot work, which is the failure this whole change exists to
    stop.

    THE PAGE'S OWN TOKEN travels with the Page. `me/accounts` returns one per
    Page and it is the only token `/{page-id}/feed` accepts.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        me = await client.get(
            "https://graph.facebook.com/v21.0/me",
            params={"access_token": token, "fields": "id,name"},
        )
        me.raise_for_status()
        user_data = me.json()

        pages = await client.get(
            "https://graph.facebook.com/v21.0/me/accounts",
            params={"access_token": token,
                    "fields": "id,name,access_token,instagram_business_account{id,username}"},
        )
        pages.raise_for_status()
        page_list = pages.json().get("data", [])

    who = {"consented_by_name": user_data.get("name", "")}
    out = []
    for page in page_list:
        page_token = page.get("access_token", "") or token
        if platform == "facebook":
            out.append(wrap(
                page.get("name", "") or "Facebook Page", "facebook_page",
                page["id"], page["id"], page_token,
                {**who, "facebook_page_name": page.get("name", "")},
            ))
            continue
        ig = page.get("instagram_business_account") or {}
        if ig.get("id"):
            out.append(wrap(
                ig.get("username") or page.get("name", "") or "Instagram account",
                "instagram_business", ig["id"], ig["id"], page_token,
                {**who, "via_facebook_page": page.get("name", "")},
            ))
    return out


async def _list_linkedin_destinations(token: str, wrap) -> list[dict]:
    """The member, and every organisation they administer.

    BOTH, WHICH IS THE OWNER'S WHOLE POINT: "any connectors can do both. depends
    on org — someone org is sole business owner who is its own page." A sole
    practitioner posts as themselves and a firm posts as its Page, and the
    product has no business deciding which.

    `account_id` is the FULL URN, not the bare id, because the urn is what
    LinkedIn's ugcPosts author field takes and it is the only value that is
    unambiguous between the two kinds. `publish_to_linkedin` reads it back.

    THE ORGANISATION HALF NEEDS AN ENTITLEMENT WE MAY NOT HOLD — see
    `_linkedin_wants_organizations`. When it is off, this returns the person
    alone and `_destination_note` says why on the screen.
    """
    import httpx
    out = []
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        me = resp.json()
        sub = me.get("sub", "")
        if sub:
            out.append(wrap(
                me.get("name", "") or "LinkedIn profile", "person",
                f"urn:li:person:{sub}", "", None,
                {"consented_by_name": me.get("name", "")},
            ))

        if not _linkedin_wants_organizations():
            return out

        # ADMINISTERED ORGANISATIONS. `organizationAcls` with `roleAssignee` is
        # the only endpoint that answers "which Pages does this member run", and
        # the projection pulls each organisation's name in the same round trip —
        # without it the response is urns alone and the picker would have to draw
        # an id, which the product forbids.
        acl = await client.get(
            "https://api.linkedin.com/v2/organizationAcls",
            params={
                "q": "roleAssignee",
                "role": "ADMINISTRATOR",
                "state": "APPROVED",
                "projection": "(elements*(organization~(id,localizedName)))",
            },
            headers={"Authorization": f"Bearer {token}",
                     "X-Restli-Protocol-Version": "2.0.0"},
        )
        if acl.status_code != 200:
            # 403 here means the app does not hold Community Management even
            # though the deployment claims it does. The person keeps their
            # personal profile rather than losing the whole connection.
            log.warning("LinkedIn organizationAcls answered %s", acl.status_code)
            return out
        for el in acl.json().get("elements", []):
            urn = el.get("organization", "")
            detail = el.get("organization~") or {}
            name = detail.get("localizedName", "")
            if not urn:
                continue
            out.append(wrap(
                name or "Company Page", "linkedin_organization", urn, "", None,
                {"consented_by_name": me.get("name", "")},
            ))
    return out


async def _list_google_destinations(token: str, wrap) -> list[dict]:
    """Every location, across every Business Profile account.

    `accounts[0]` then `locations[0]` was the old answer, and a firm with a
    branch office posted to whichever branch Google listed first. A location is
    a shopfront; picking one for somebody is picking which town their post
    appears in.
    """
    import httpx
    out = []
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        accounts = resp.json().get("accounts", [])

        for account in accounts:
            account_name = account.get("name", "")
            if not account_name:
                continue
            loc_resp = await client.get(
                f"https://mybusinessbusinessinformation.googleapis.com/v1/"
                f"{account_name}/locations",
                params={"readMask": "name,title,storefrontAddress"},
                headers={"Authorization": f"Bearer {token}"},
            )
            if loc_resp.status_code != 200:
                log.warning("Google locations for %s answered %s",
                            account_name, loc_resp.status_code)
                continue
            for loc in loc_resp.json().get("locations", []):
                resource = loc.get("name", "")
                if not resource:
                    continue
                out.append(wrap(
                    loc.get("title", "") or account.get("accountName", "")
                    or "Business location",
                    "google_location", resource, resource, None,
                    {"google_account_name": account.get("accountName", "")},
                ))
    return out


async def _list_youtube_destinations(token: str, wrap) -> list[dict]:
    """Every channel this Google account owns.

    UNVERIFIED AGAINST A LIVE ACCOUNT — no OAuth flow has ever been completed
    against a real network from this repository, and this shape comes from the
    published Data API v3 reference. It is wrapped by `_list_destinations`, so a
    wrong field name costs the person a sentence saying nothing came back, which
    is exactly what they get today.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={"part": "snippet", "mine": "true"},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
    return [
        wrap((it.get("snippet") or {}).get("title", "") or "YouTube channel",
             "youtube_channel", it.get("id", ""))
        for it in items if it.get("id")
    ]


async def _list_pinterest_destinations(token: str, wrap) -> list[dict]:
    """Every board. A Pin goes to a BOARD, never to an account.

    UNVERIFIED AGAINST A LIVE ACCOUNT — see `_list_youtube_destinations`.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://api.pinterest.com/v5/boards",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
    return [
        wrap(b.get("name", "") or "Pinterest board", "pinterest_board",
             b.get("id", ""))
        for b in items if b.get("id")
    ]


async def _list_twitter_destinations(token: str, wrap) -> list[dict]:
    """The one profile the consent covers.

    X has no page concept: an account posts as itself. The picker still asks,
    because a firm with two X accounts connects each one separately and the
    uniqueness key now lets both live — which it did not before.

    UNVERIFIED AGAINST A LIVE ACCOUNT — see `_list_youtube_destinations`.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://api.x.com/2/users/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
    if not data.get("id"):
        return []
    return [wrap(data.get("username") or data.get("name") or "X account",
                 "account", data["id"])]


async def _list_threads_destinations(token: str, wrap) -> list[dict]:
    """The one Threads profile the consent covers.

    UNVERIFIED AGAINST A LIVE ACCOUNT — see `_list_youtube_destinations`.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://graph.threads.net/v1.0/me",
            params={"fields": "id,username", "access_token": token},
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("id"):
        return []
    return [wrap(data.get("username") or "Threads account", "account", data["id"])]


async def _list_reddit_destinations(token: str, wrap) -> list[dict]:
    """The Reddit account itself.

    NOT the subreddits. `publish_to_reddit` takes a subreddit in `page_id`, and
    which subreddits a firm may post to is a per-post editorial decision, not a
    connection. Choosing one here would silently fix every future post to it.

    UNVERIFIED AGAINST A LIVE ACCOUNT — see `_list_youtube_destinations`.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://oauth.reddit.com/api/v1/me",
            headers={"Authorization": f"Bearer {token}",
                     "User-Agent": "Kartavya/1.0"},
        )
        resp.raise_for_status()
        data = resp.json()
    name = data.get("name", "")
    if not name:
        return []
    return [wrap(f"u/{name}", "account", data.get("id", "") or name, f"u_{name}")]


async def _fetch_meta_accounts(token: str, platform: str) -> dict:
    """Fetch the user's Facebook Pages (and linked Instagram accounts).

    SUPERSEDED by `_list_meta_destinations`, and no longer on the connect path.
    `page = page_list[0]` below is the defect the picker exists to close. Kept
    because it is a public name in this module and deleting it is not this
    change's business.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        me = await client.get(
            "https://graph.facebook.com/v21.0/me",
            params={"access_token": token, "fields": "id,name"},
        )
        me.raise_for_status()
        user_data = me.json()

        pages = await client.get(
            "https://graph.facebook.com/v21.0/me/accounts",
            params={"access_token": token, "fields": "id,name,access_token,instagram_business_account"},
        )
        pages.raise_for_status()
        page_list = pages.json().get("data", [])

    if not page_list:
        return {"id": user_data["id"], "name": user_data.get("name", "")}

    page = page_list[0]
    result = {
        "id": user_data["id"],
        "name": page.get("name", user_data.get("name", "")),
        "page_id": page["id"],
        "page_token": page.get("access_token", ""),
    }

    if platform == "instagram":
        ig = page.get("instagram_business_account", {})
        if ig.get("id"):
            result["page_id"] = ig["id"]

    return result


async def _fetch_linkedin_profile(token: str) -> dict:
    """Fetch LinkedIn user profile.

    SUPERSEDED by `_list_linkedin_destinations`, and no longer on the connect
    path. Returning `sub` alone is what made every firm's posts land on the
    consenting partner's personal feed. Kept, not called.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "id": data.get("sub", ""),
        "name": data.get("name", ""),
    }


async def _fetch_google_locations(token: str) -> dict:
    """Fetch first Google Business Profile location.

    SUPERSEDED by `_list_google_destinations`, and no longer on the connect path.
    Its own docstring says "first", which is the whole problem. Kept, not called.
    """
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        accounts = resp.json().get("accounts", [])

    if not accounts:
        return {"id": "", "name": "No account found"}

    account = accounts[0]
    account_name = account.get("name", "")

    async with httpx.AsyncClient(timeout=15) as client:
        loc_resp = await client.get(
            f"https://mybusinessbusinessinformation.googleapis.com/v1/{account_name}/locations",
            headers={"Authorization": f"Bearer {token}"},
        )
        if loc_resp.status_code == 200:
            locations = loc_resp.json().get("locations", [])
            if locations:
                loc = locations[0]
                return {
                    "id": account_name,
                    "name": loc.get("title", account.get("accountName", "")),
                    "location_name": loc.get("name", ""),
                }

    return {
        "id": account_name,
        "name": account.get("accountName", ""),
        "location_name": "",
    }


# ── The picker ──────────────────────────────────────────────


@router.get("/oauth/pending/{choice_token}")
async def pending_destinations(
    choice_token: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """The destinations one parked consent grants — names, and what each one IS.

    ── WHY THIS ROUTE CARRIES NO AUTHORITY DEPENDENCY ──────────────────────────
    It carries something narrower. The parked row records the person who started
    the consent, and only THAT person can read it back: a caller who is not
    `state_data.user_id` gets 404 regardless of their rung, so this cannot be
    used to browse anybody else's pending consents, and there is no rung that
    unlocks it. The admin rung was already spent — `oauth_authorize` is gated on
    `_require_connect_authority`, so a parked row can only exist because an
    admin made it — and the row is spent again at the storing end, which is
    `connect_social_account` and IS on the admin rung.

    This is deliberately not a fourth copy of the ladder. `test_social_access_
    matrix.py` sweeps every route in this module that carries one of the two
    authority dependencies and refuses any it has not classified; the settled
    matrix is the two rungs it names, and a read of one's own consent is neither.

    NEVER A TOKEN. The list exists so the browser can choose, and the whole
    reason the tokens stay parked server-side is that a payload the browser
    holds is a payload that has left the server. Never a destination id either —
    names, and an opaque positional key.
    """
    pending = await _read_pending_choice(choice_token)
    if not pending:
        raise HTTPException(
            404,
            "That connection has expired. Connect the network again — it only "
            "takes the consent screen, and nothing was saved.",
        )
    if pending.get("user_id") != user["user_id"] or pending.get("org_id") != org_id:
        # Same sentence as an expired one. Telling a stranger that a token is
        # valid but not theirs tells them a token is valid.
        raise HTTPException(404, "That connection has expired. Connect the network again.")

    return {
        "platform": pending.get("platform", ""),
        # The client the consent was given FOR, which the picker posts back to.
        # The round trip through the provider is a full page load, so the page
        # has forgotten which client was selected and would otherwise store
        # against whichever one it defaults to. A `client_id` is a selector
        # value on this page already and is never drawn; the NAME beside it is
        # what a human reads.
        "client_id": pending.get("client_id", ""),
        "client_name": pending.get("client_name", ""),
        "note": pending.get("note", ""),
        "destinations": [
            _public_destination(i, d)
            for i, d in enumerate(pending.get("destinations", []))
        ],
    }


async def _store_chosen_destinations(
    pool, cid: str, org_id: str, user: dict, body: SocialAccountConnect,
) -> dict:
    """Write ONE ROW PER CHOSEN DESTINATION, and only now.

    Each becomes a separately connected account that can be posted to on its
    own: it has its own name, its own token, its own row in the publish queue and
    its own line in the accounts list. Choosing three is choosing three accounts,
    not one account with three faces.

    THE UNIQUENESS KEY. `ON CONFLICT (client_id, platform, account_id)` is the
    constraint that has always been on the table, and it is only correct now
    because `account_id` finally holds the DESTINATION's id. While it held the
    consenting person's id, connecting a second Page conflicted with the first
    and the DO UPDATE overwrote it — token and all. Migration 188 makes that key
    total; see its header.
    """
    pending = await _read_pending_choice(body.choice_token)
    if not pending:
        raise HTTPException(
            400,
            "That connection has expired. Connect the network again — nothing "
            "was saved.",
        )
    if pending.get("user_id") != user["user_id"] or pending.get("org_id") != org_id:
        raise HTTPException(400, "That connection has expired. Connect the network again.")
    if pending.get("client_id") != cid:
        raise HTTPException(
            400,
            f"That consent was given for {pending.get('client_name') or 'another client'}. "
            f"Finish it from that client's accounts.",
        )

    platform = pending.get("platform", "")
    if platform not in ALL_PLATFORMS:
        raise HTTPException(400, f"Invalid platform. Must be one of: {', '.join(ALL_PLATFORMS)}")

    by_key = {
        f"d{i}": d for i, d in enumerate(pending.get("destinations", []))
    }
    # A destination with no id of its own cannot be the unique thing in
    # `(client_id, platform, account_id)`, so storing it would collapse onto
    # whatever else has none and overwrite it. Every lister guards against this
    # already; the belt is here because the payload is jsonb and a future lister
    # is one `.get()` away from producing an empty string.
    chosen = [
        by_key[k] for k in body.destinations
        if k in by_key and (by_key[k].get("account_id") or "").strip()
    ]
    if not chosen:
        raise HTTPException(400, "Choose at least one destination to post as.")

    stored = []
    for dest in chosen:
        # Back to a datetime. It went into jsonb as an ISO string because jsonb
        # has no timestamp type; asyncpg binds a timestamptz parameter from a
        # datetime and refuses a str, so the round trip has to be closed here.
        raw_expiry = dest.get("token_expires_at")
        expires = None
        if raw_expiry:
            try:
                expires = datetime.fromisoformat(raw_expiry)
            except (TypeError, ValueError):
                log.warning("unparseable token expiry parked for %s", platform)
        row = await pool.fetchrow(
            "INSERT INTO public.hub_social_accounts "
            "(client_id, org_id, platform, account_name, account_id, page_id, "
            " access_token, refresh_token, token_expires_at, scopes, metadata, "
            " connected_by) "
            "VALUES ($1::uuid, NULLIF($2,'')::uuid, $3, $4, $5, $6, $7, $8, "
            "        $9::timestamptz, $10, $11::jsonb, $12) "
            "ON CONFLICT (client_id, platform, account_id) DO UPDATE SET "
            "access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, "
            "token_expires_at=EXCLUDED.token_expires_at, "
            "account_name=EXCLUDED.account_name, page_id=EXCLUDED.page_id, "
            "scopes=EXCLUDED.scopes, metadata=EXCLUDED.metadata, "
            "org_id=COALESCE(EXCLUDED.org_id, public.hub_social_accounts.org_id), "
            "is_active=TRUE, updated_at=NOW() "
            "RETURNING platform, account_name",
            cid, org_id or "", platform,
            dest.get("name", ""), dest.get("account_id", ""), dest.get("page_id", ""),
            # ALREADY CIPHERTEXT. `_list_destinations` encrypted these on the way
            # into the parked payload; calling `encrypt` again here would store a
            # ciphertext of a ciphertext and every publish would fail against a
            # token the network has never issued.
            dest.get("access_token", ""), dest.get("refresh_token"),
            expires, dest.get("scopes") or [],
            json.dumps(dest.get("metadata") or {}), user["user_id"],
        )
        stored.append({
            "platform": row["platform"],
            "account_name": row["account_name"],
            "what": DESTINATION_KINDS.get(dest.get("kind") or "account", "account"),
        })

    # The consent is spent. The parked tokens go with it — a second press of the
    # same button finds nothing, which is correct: the rows are already there.
    await _discard_pending_choice(body.choice_token)
    return {"status": "connected", "connected": len(stored), "accounts": stored}


# ── Social Accounts (manual + list) ───────────────────────

@router.get("/clients/{client_id}/social-accounts")
async def list_social_accounts(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)
    rows = await pool.fetch(
        # `destination_kind` is what makes a list of three accounts on one
        # network readable. Without it the panel draws three names and cannot
        # say which is the Company Page and which is somebody's personal
        # profile — and those are different audiences. Read out of the jsonb
        # rather than a column; see migration 188 for why it lives there.
        "SELECT id, platform, account_name, account_id, page_id, "
        "metadata->>'destination_kind' AS destination_kind, "
        "token_expires_at, is_active, connected_at "
        "FROM public.hub_social_accounts "
        "WHERE client_id=$1::uuid AND is_active=TRUE "
        "ORDER BY platform, account_name",
        cid,
    )
    return {"data": [
        # The label, resolved here, so the browser holds no second copy of a map
        # only this file can keep correct. An unknown or absent kind resolves to
        # an empty string and the panel simply draws the name, which is what it
        # did before any of this existed.
        {**dict(r), "what": DESTINATION_KINDS.get(r["destination_kind"] or "", "")}
        for r in rows
    ]}


@router.post("/clients/{client_id}/social-accounts")
async def connect_social_account(
    client_id: UUID,
    body: SocialAccountConnect,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
    _auth=Depends(_require_connect_authority),
):
    pool = await get_pool()
    cid = str(client_id)

    cl = await pool.fetchrow(
        "SELECT 1 FROM public.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        cid, org_id,
    )
    if not cl:
        raise HTTPException(404, "Client not found")

    # THE PICKER'S OTHER END. A body carrying a `choice_token` is a human having
    # answered "post as…?" for a consent this router parked; it stores one row
    # per destination chosen and is the ONLY path by which an OAuth connection
    # ever reaches this table. Same route, same admin rung, same client check —
    # see `SocialAccountConnect` for why it is not a route of its own.
    if body.choice_token:
        return await _store_chosen_destinations(pool, cid, org_id, user, body)

    if body.platform not in ALL_PLATFORMS:
        raise HTTPException(400, f"Invalid platform. Must be one of: {', '.join(ALL_PLATFORMS)}")

    row = await pool.fetchrow(
        "INSERT INTO public.hub_social_accounts "
        "(client_id, org_id, platform, account_name, account_id, page_id, "
        " access_token, refresh_token, scopes, connected_by) "
        "VALUES ($1::uuid, NULLIF($10,'')::uuid, $2, $3, $4, $5, $6, $7, $8, $9) "
        "ON CONFLICT (client_id, platform, account_id) DO UPDATE SET "
        "access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, "
        "account_name=EXCLUDED.account_name, page_id=EXCLUDED.page_id, "
        "is_active=TRUE, updated_at=NOW() "
        "RETURNING id, platform, account_name",
        cid, body.platform, body.account_name, body.account_id.strip(),
        # NULL, never ''. Every publisher reads `page_id or account_id`, and an
        # empty string only falls through to account_id because Python calls it
        # falsy — one refactor to `.get("page_id", …)` away from posting to the
        # empty string. Migration 188 refuses '' outright.
        body.page_id.strip() or None, encrypt(body.access_token),
        encrypt(body.refresh_token) if body.refresh_token else None,
        body.scopes or [], user["user_id"],
        # `org_id` has existed on this table since the org backfill and has never
        # been written by this router, so every row it makes is orphaned from the
        # org index it is supposed to sit on. Zero rows exist, so there is
        # nothing to repair — only a hole to stop digging.
        org_id or "",
    )
    return {"status": "connected", **dict(row)}


@router.delete("/clients/{client_id}/social-accounts/{account_id}")
async def disconnect_social_account(
    client_id: UUID,
    account_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
    _auth=Depends(_require_connect_authority),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE public.hub_social_accounts sa SET is_active=FALSE, updated_at=NOW() "
        "FROM public.hub_clients c "
        "WHERE sa.id=$1::uuid AND sa.client_id=$2::uuid "
        "AND c.id = sa.client_id AND c.org_id=$3::uuid",
        str(account_id), str(client_id), org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Social account not found")
    return {"status": "disconnected"}


# ── Publishing Queue ────────────────────────────────────────

@router.post("/clients/{client_id}/publish/schedule")
async def schedule_post(
    client_id: UUID,
    body: SchedulePost,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
    # Scheduling had NO authority check at all — only the module gate — while
    # publish-now had one, and the two end in the same place: words in front
    # of the client's audience under the client's name. The cron does not ask
    # who queued the row. Same rung as publish-now.
    _auth=Depends(_require_send_authority),
):
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)

    content = await pool.fetchrow(
        "SELECT id, status FROM public.hub_content_items WHERE id=$1::uuid AND client_id=$2::uuid",
        body.content_id, cid,
    )
    if not content:
        raise HTTPException(404, "Content not found")
    if content["status"] not in ("approved", "draft"):
        raise HTTPException(400, f"Content must be approved or draft to schedule (current: {content['status']})")

    account = await pool.fetchrow(
        "SELECT id FROM public.hub_social_accounts "
        "WHERE id=$1::uuid AND client_id=$2::uuid AND is_active=TRUE",
        body.social_account_id, cid,
    )
    if not account:
        raise HTTPException(404, "Social account not found")

    row = await pool.fetchrow(
        "INSERT INTO public.hub_publish_queue "
        "(content_id, social_account_id, client_id, scheduled_for, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5) RETURNING id",
        body.content_id, body.social_account_id, cid, body.scheduled_for, user["user_id"],
    )

    await pool.execute(
        "UPDATE public.hub_content_items SET status='scheduled', scheduled_for=$1 "
        "WHERE id=$2::uuid AND status IN ('draft', 'approved')",
        body.scheduled_for, body.content_id,
    )

    return {"queue_id": str(row["id"]), "status": "scheduled"}


@router.post("/clients/{client_id}/publish/bulk-schedule")
async def bulk_schedule(
    client_id: UUID,
    body: BulkSchedule,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
    # Scheduling had NO authority check at all — only the module gate — while
    # publish-now had one, and the two end in the same place: words in front
    # of the client's audience under the client's name. The cron does not ask
    # who queued the row. Same rung as publish-now.
    _auth=Depends(_require_send_authority),
):
    """Schedule same content to multiple platforms at once."""
    cid = str(client_id)
    pool = await get_pool()
    await _require_client_in_org(pool, cid, org_id)

    # This route validated nothing at all — it inserted whatever content_id and
    # social_account_id it was handed. Given an account id from another org it
    # would publish that org's queue item to their real social account. The
    # single-post route checks both ids against the client; so does this one now.
    content = await pool.fetchval(
        "SELECT id FROM public.hub_content_items "
        "WHERE id=$1::uuid AND client_id=$2::uuid",
        body.content_id, cid,
    )
    if not content:
        raise HTTPException(404, "Content not found")

    results = []
    for acct_id in body.account_ids:
        owned = await pool.fetchval(
            "SELECT 1 FROM public.hub_social_accounts "
            "WHERE id=$1::uuid AND client_id=$2::uuid AND is_active=TRUE",
            acct_id, cid,
        )
        if not owned:
            results.append({"account_id": acct_id, "status": "failed",
                            "error": "Social account not found"})
            continue
        try:
            row = await pool.fetchrow(
                "INSERT INTO public.hub_publish_queue "
                "(content_id, social_account_id, client_id, scheduled_for, created_by) "
                "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5) RETURNING id",
                body.content_id, acct_id, cid, body.scheduled_for, user["user_id"],
            )
            results.append({"account_id": acct_id, "queue_id": str(row["id"]), "status": "scheduled"})
        except Exception as exc:
            results.append({"account_id": acct_id, "status": "failed", "error": str(exc)[:100]})

    return {"results": results}


@router.post("/publish/queue/{queue_id}/publish-now")
async def publish_now(
    queue_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
    _auth=Depends(_require_send_authority),
):
    """Immediately publish a scheduled post."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT q.id FROM public.hub_publish_queue q "
        "JOIN public.hub_clients c ON c.id = q.client_id "
        "WHERE q.id=$1::uuid AND c.org_id=$2::uuid",
        str(queue_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Queue item not found")
    result = await publish_content(str(queue_id))
    return result


@router.post("/publish/queue/{queue_id}/cancel")
async def cancel_scheduled(
    queue_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE public.hub_publish_queue q SET status='cancelled' "
        "FROM public.hub_clients c "
        "WHERE q.id=$1::uuid AND q.status='scheduled' "
        "AND c.id = q.client_id AND c.org_id=$2::uuid",
        str(queue_id), org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Queue item not found")
    return {"status": "cancelled"}


@router.get("/clients/{client_id}/publish/queue")
async def list_publish_queue(
    client_id: UUID,
    status: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)

    query = (
        "SELECT q.id, q.scheduled_for, q.status, q.platform_url, q.error_message, "
        "q.published_at, q.retry_count, "
        "c.title as content_title, c.body as content_body, "
        "sa.platform, sa.account_name "
        "FROM public.hub_publish_queue q "
        "JOIN public.hub_content_items c ON c.id = q.content_id "
        "JOIN public.hub_social_accounts sa ON sa.id = q.social_account_id "
        "WHERE q.client_id=$1::uuid "
    )
    params = [cid]

    if status:
        query += "AND q.status=$2 "
        params.append(status)

    query += "ORDER BY q.scheduled_for DESC"
    rows = await pool.fetch(query, *params)
    return {"data": [dict(r) for r in rows]}


# ── Content Calendar ────────────────────────────────────────

@router.get("/clients/{client_id}/calendar")
async def content_calendar(
    client_id: UUID,
    month: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """Get all scheduled/published content for a month (content calendar view)."""
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)

    if month:
        year, mo = month.split("-")
        start = f"{year}-{mo}-01"
        end = f"{year}-{int(mo)+1:02d}-01" if int(mo) < 12 else f"{int(year)+1}-01-01"
    else:
        from datetime import date
        today = date.today()
        start = today.replace(day=1).isoformat()
        if today.month < 12:
            end = today.replace(month=today.month + 1, day=1).isoformat()
        else:
            end = today.replace(year=today.year + 1, month=1, day=1).isoformat()

    items = await pool.fetch(
        "SELECT q.id, q.scheduled_for, q.status, q.published_at, "
        "c.title, c.agent_type, c.platform as content_platform, "
        "sa.platform, sa.account_name "
        "FROM public.hub_publish_queue q "
        "JOIN public.hub_content_items c ON c.id = q.content_id "
        "JOIN public.hub_social_accounts sa ON sa.id = q.social_account_id "
        "WHERE q.client_id=$1::uuid "
        "AND q.scheduled_for >= $2::date AND q.scheduled_for < $3::date "
        "ORDER BY q.scheduled_for",
        cid, start, end,
    )
    return {"data": [dict(r) for r in items]}


# ── Cron: Process Scheduled Posts ──────────────────────────

@router.post("/publish/dispatch")
async def dispatch_scheduled_posts(
    request: Request,
    request_secret: str = Query(""),
):
    """Cron endpoint — process all posts whose scheduled_for has passed.
    Secured by PUBLISH_DISPATCH_SECRET env var (same pattern as task-reminders).
    """
    # `!=` on a str short-circuits at the first differing byte, so the time to
    # fail leaks how many leading bytes were correct — and a cron endpoint can be
    # called as often as an attacker likes. `secret_matches` is constant-time and
    # also returns False when either side is empty, so an unset env var cannot be
    # matched by an omitted parameter. This is the same helper
    # `scheduler._verify_cron`, `reports.dispatch_reports` and
    # `task_reminders.dispatch_reminders` already use; this route was the only
    # dispatch endpoint still comparing with `!=`.
    from utils import secret_matches

    expected = os.getenv("PUBLISH_DISPATCH_SECRET", "")
    if not secret_matches(request_secret, expected):
        raise HTTPException(403, "Invalid dispatch secret")

    results = await process_scheduled_posts()
    published = sum(1 for r in results if r.get("status") == "published")
    failed = sum(1 for r in results if r.get("status") == "failed")
    return {"processed": len(results), "published": published, "failed": failed}


# ── Client Platform Management (Aekam controls) ─────────

class PlatformToggle(BaseModel):
    platforms: list[str]


@router.get("/clients/{client_id}/platforms")
async def list_client_platforms(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """List which platforms are enabled for this client."""
    pool = await get_pool()
    cid = str(client_id)
    await _require_client_in_org(pool, cid, org_id)
    rows = await pool.fetch(
        "SELECT platform, enabled FROM public.hub_client_platforms "
        "WHERE client_id=$1::uuid ORDER BY platform",
        cid,
    )
    enabled = [r["platform"] for r in rows if r["enabled"]]
    return {"enabled": enabled, "all_platforms": ALL_PLATFORMS}


@router.put("/clients/{client_id}/platforms")
async def set_client_platforms(
    client_id: UUID,
    body: PlatformToggle,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
    _auth=Depends(_require_connect_authority),
):
    """Set which platforms a client can use. Only valid platform keys accepted."""
    pool = await get_pool()
    cid = str(client_id)

    cl = await pool.fetchrow(
        "SELECT 1 FROM public.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        cid, org_id,
    )
    if not cl:
        raise HTTPException(404, "Client not found")

    invalid = [p for p in body.platforms if p not in ALL_PLATFORMS]
    if invalid:
        raise HTTPException(400, f"Invalid platforms: {', '.join(invalid)}")

    await pool.execute(
        "DELETE FROM public.hub_client_platforms WHERE client_id=$1::uuid", cid,
    )
    for p in body.platforms:
        await pool.execute(
            "INSERT INTO public.hub_client_platforms (client_id, platform, enabled, enabled_by, org_id) "
            "VALUES ($1::uuid, $2, TRUE, $3, $4::uuid)",
            cid, p, user["user_id"], org_id,
        )

    return {"enabled": body.platforms}
