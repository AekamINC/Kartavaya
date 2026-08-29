"""connector_credentials.py — each network's own form, and whose app answers.

── WHY THE FORMS ARE PER-PLATFORM ──────────────────────────────────────────────

The owner rejected a generic "client id / secret" pair explicitly. The reason is
not cosmetic. The person filling this in is an operator with the network's own
console open in another tab, and the console does not say "client id" — Meta
says **App ID** under Settings → Basic, LinkedIn says **Client ID** under Auth,
Google says **Client ID** under Credentials → OAuth 2.0 Client IDs, and WhatsApp
Cloud API says **Phone number ID**, which is not a client id at all and has no
secret beside it. A form that calls all of those "client id" makes the operator
guess which of four values on their screen is meant, and a wrong guess produces
an OAuth error page three steps later with nothing pointing back at the field.

So every platform declares its OWN fields, each with the label the network
prints and a `where` line naming the exact page it is on. `WHERE_CHECKED` at the
bottom records when each of those paths was last verified against the live
console, because a stale instruction is worse than none — it sends someone to a
page that no longer exists and they conclude the product is broken.

── WHOSE APP: per-client, then Aekam, then the environment ────────────────────

Both levels, which is the owner's decision. `resolve()` is the only reader:

    1. this client's own row      an agency's customer with their own Meta app
    2. the org's default row      Aekam's app, used for everyone else
    3. the environment variable   what `hub_publish.py` reads TODAY

Step 3 is why nothing breaks the day this ships. Every OAuth config in
`routers/hub_publish.py` names an `env_id` and an `env_secret`, and those keep
working untouched for any platform nobody has filled a form in for. Measured on
staging 2026-08-07: not one of those variables is set, so in practice step 3
answers "nothing" everywhere — but it is production's contract and it is not
this change's business to break it.

── WHAT THE BROWSER NEVER SEES ────────────────────────────────────────────────

`decrypt` is called in exactly one place — `resolve`, server-side, on the way to
a token exchange. Nothing in `routers/hub_connectors.py` returns a secret, and
the redaction is by construction rather than by remembering: `public_view()`
builds the response from `public_fields` plus `has_secret` and a four-character
hint, so a new secret field added to a spec cannot leak by being forgotten in a
serialiser.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional

from services import connector_setup, encryption

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Field:
    """One box on one platform's form.

    `key`     what it is stored as. Public fields land in `public_fields`;
              secret ones land inside the encrypted blob.
    `label`   what the NETWORK calls it, not what we would call it.
    `where`   the exact page it is copied from. This is the whole point.
    `secret`  never returned to the browser once saved.
    """
    key: str
    label: str
    where: str
    secret: bool = False
    required: bool = True
    placeholder: str = ""
    help: str = ""


@dataclass(frozen=True)
class PlatformSpec:
    """A network, its form, and how it is connected.

    `kind` is the difference the screen is drawn from:

      oauth   the operator saves an app id and secret, then each client presses
              Connect and completes consent in a popup. The redirect URL has to
              be pasted into the network's console FIRST or consent fails, which
              is why every card shows it.
      token   there is no consent round-trip. Meta's WhatsApp Cloud API is the
              one that matters here: a permanent token, a phone number id, a
              WABA id, and a verify token the operator INVENTS and types into
              both consoles. It is one card on this page, not a separate screen.
      lead    an inbound source. Credentials are saved here so they are in one
              place, but nothing publishes to them — see `publishes`.
    """
    key: str
    label: str
    kind: str
    fields: tuple[Field, ...]
    console: str
    #: False for JustDial and IndiaMART. They are lead sources, and a Publish
    #: screen offering them as a destination would be offering something that
    #: cannot work. Ingestion is a separate job.
    publishes: bool = True
    #: Shown on the card, verbatim, when there is something the operator has to
    #: know before they start.
    caution: str = ""
    #: Only `oauth` and `token` platforms have one; `lead` sources do not.
    redirect_path: str = ""
    notes: tuple[str, ...] = ()


_ID = "App ID"

#: Every platform this product can hold credentials for.
#:
#: REMOVED 2026-08-07 on the owner's instruction: **TikTok** (banned in India,
#: so an Indian firm cannot use it and offering it is a support ticket),
#: **Telegram** and **Snapchat** (unconnectable, and the owner ruled them out
#: rather than leaving them showing an error).
#:
#: KEPT and now configured: **Twitter/X**, which had an entry in `ALL_PLATFORMS`
#: and none in `OAUTH_CONFIGS`, so it answered `400 Unsupported platform`. See
#: its `caution` — posting is a PAID tier and that is a decision, not a detail.
SPECS: tuple[PlatformSpec, ...] = (
    PlatformSpec(
        "facebook", "Facebook Pages", "oauth",
        console="https://developers.facebook.com/apps",
        redirect_path="/api/v1/hub/oauth/facebook/callback",
        fields=(
            Field("app_id", _ID,
                  "Meta app dashboard → Settings → Basic → App ID",
                  placeholder="1234567890123456"),
            Field("app_secret", "App Secret",
                  "Meta app dashboard → Settings → Basic → App Secret (press Show)",
                  secret=True),
        ),
        notes=(
            "Add the redirect URL under Products → Facebook Login → Settings → "
            "Valid OAuth Redirect URIs before anyone presses Connect.",
            "The app needs pages_manage_posts and pages_read_engagement, which "
            "require App Review before it can leave Development mode.",
        ),
    ),
    PlatformSpec(
        "instagram", "Instagram", "oauth",
        console="https://developers.facebook.com/apps",
        redirect_path="/api/v1/hub/oauth/instagram/callback",
        fields=(
            Field("app_id", _ID,
                  "The SAME Meta app as Facebook — Settings → Basic → App ID",
                  placeholder="1234567890123456"),
            Field("app_secret", "App Secret",
                  "The same Meta app — Settings → Basic → App Secret", secret=True),
        ),
        caution="Instagram publishing works only for a Professional account "
                "linked to a Facebook Page. A personal account cannot be posted "
                "to by any API.",
        notes=("Usually the same app id and secret as the Facebook card. They are "
               "separate rows so an agency can split them if it ever needs to.",),
    ),
    PlatformSpec(
        "linkedin", "LinkedIn", "oauth",
        console="https://www.linkedin.com/developers/apps",
        redirect_path="/api/v1/hub/oauth/linkedin/callback",
        fields=(
            Field("client_id", "Client ID",
                  "LinkedIn app → Auth tab → Application credentials → Client ID"),
            Field("client_secret", "Primary Client Secret",
                  "LinkedIn app → Auth tab → Primary Client Secret", secret=True),
        ),
        notes=("Add the redirect URL under Auth → OAuth 2.0 settings → "
               "Authorized redirect URLs.",
               "The app must have the Share on LinkedIn and Sign In with "
               "LinkedIn products added, or the scopes are refused."),
    ),
    PlatformSpec(
        "google_business", "Google Business Profile", "oauth",
        console="https://console.cloud.google.com/apis/credentials",
        redirect_path="/api/v1/hub/oauth/google_business/callback",
        fields=(
            Field("client_id", "Client ID",
                  "Google Cloud console → APIs & Services → Credentials → "
                  "OAuth 2.0 Client IDs → your web client",
                  placeholder="…apps.googleusercontent.com"),
            Field("client_secret", "Client secret",
                  "The same OAuth client → Client secret", secret=True),
        ),
        notes=("Add the redirect URL under Authorised redirect URIs on that same "
               "OAuth client.",
               "The Business Profile API has to be enabled on the project AND "
               "access requested — Google grants it per project, by form."),
    ),
    PlatformSpec(
        "youtube", "YouTube", "oauth",
        console="https://console.cloud.google.com/apis/credentials",
        redirect_path="/api/v1/hub/oauth/youtube/callback",
        fields=(
            Field("client_id", "Client ID",
                  "Google Cloud console → Credentials → OAuth 2.0 Client IDs",
                  placeholder="…apps.googleusercontent.com"),
            Field("client_secret", "Client secret",
                  "The same OAuth client → Client secret", secret=True),
        ),
        notes=("Usually the same Google OAuth client as Business Profile, with "
               "the YouTube Data API v3 also enabled.",),
    ),
    PlatformSpec(
        "twitter", "X (Twitter)", "oauth",
        console="https://developer.x.com/en/portal/dashboard",
        redirect_path="/api/v1/hub/oauth/twitter/callback",
        fields=(
            Field("client_id", "OAuth 2.0 Client ID",
                  "X developer portal → your project → your app → Keys and "
                  "tokens → OAuth 2.0 Client ID and Client Secret"),
            Field("client_secret", "OAuth 2.0 Client Secret",
                  "The same Keys and tokens page. Shown ONCE — regenerate it if "
                  "it was not copied.", secret=True),
        ),
        caution="POSTING ON X IS A PAID TIER. The free access level is "
                "read-limited and cannot create posts, so this card can be "
                "filled in and still not publish until a paid plan is on the "
                "developer account. Confirm the plan before promising a client "
                "that X works.",
        notes=("Set the app's type to Web App and add the redirect URL under "
               "User authentication settings → Callback URI.",
               "Scopes needed: tweet.write, tweet.read, users.read, "
               "offline.access."),
    ),
    PlatformSpec(
        "threads", "Threads", "oauth",
        console="https://developers.facebook.com/apps",
        redirect_path="/api/v1/hub/oauth/threads/callback",
        fields=(
            Field("app_id", _ID, "Meta app dashboard → Settings → Basic"),
            Field("app_secret", "App Secret",
                  "Meta app dashboard → Settings → Basic", secret=True),
        ),
        notes=("The Meta app needs the Threads API product added separately from "
               "Facebook Login.",),
    ),
    PlatformSpec(
        "pinterest", "Pinterest", "oauth",
        console="https://developers.pinterest.com/apps",
        redirect_path="/api/v1/hub/oauth/pinterest/callback",
        fields=(
            Field("app_id", "App ID",
                  "Pinterest developer app → Configure → App ID"),
            Field("app_secret", "App secret key",
                  "Pinterest developer app → Configure → App secret key",
                  secret=True),
        ),
        notes=("A new Pinterest app is in Trial access and can only post to the "
               "developer's own boards until standard access is granted.",),
    ),
    PlatformSpec(
        "reddit", "Reddit", "oauth",
        console="https://www.reddit.com/prefs/apps",
        redirect_path="/api/v1/hub/oauth/reddit/callback",
        fields=(
            Field("client_id", "Client ID",
                  "reddit.com/prefs/apps → your app → the string directly under "
                  "the app name (there is no label on it)"),
            Field("client_secret", "Secret",
                  "The same box, the field labelled secret", secret=True),
        ),
        notes=("The app type must be 'web app'. A 'script' app cannot complete "
               "this flow.",),
    ),

    # ── Not OAuth ───────────────────────────────────────────────────────────
    PlatformSpec(
        "whatsapp_business", "WhatsApp Business", "token",
        console="https://business.facebook.com/wa/manage",
        redirect_path="/api/v1/varta/webhook",
        fields=(
            Field("phone_number_id", "Phone number ID",
                  "Meta app → WhatsApp → API Setup → the ID under the sending "
                  "number. NOT the phone number itself.",
                  placeholder="109…",
                  help="A long numeric id. If you typed +91…, it is the wrong "
                       "value."),
            Field("waba_id", "WhatsApp Business Account ID",
                  "Meta app → WhatsApp → API Setup, directly above the phone "
                  "number id"),
            Field("access_token", "Permanent access token",
                  "Business settings → Users → System users → your system user "
                  "→ Generate token, with whatsapp_business_messaging and "
                  "whatsapp_business_management",
                  secret=True,
                  help="Generate it against a SYSTEM USER. The temporary token "
                       "on the API Setup page expires in 24 hours."),
            Field("verify_token", "Webhook verify token",
                  "You invent this one. Type any long random string here, then "
                  "paste the SAME string into Meta's webhook configuration.",
                  secret=True,
                  help="It is a shared password between the two consoles, not a "
                       "value Meta gives you."),
        ),
        caution="This is not an OAuth connector. Nothing opens a consent popup — "
                "all four values are copied from Meta's console by hand.",
        notes=("Paste the callback URL and the verify token into Meta app → "
               "WhatsApp → Configuration → Webhook, then subscribe to the "
               "messages field.",
               "Business-initiated messages need an approved template. The "
               "24-hour session window applies to everything else."),
    ),

    # ── Inbound lead sources. Credentials only. ─────────────────────────────
    PlatformSpec(
        "justdial", "JustDial", "lead", publishes=False,
        console="https://www.justdial.com/leads",
        fields=(
            Field("api_key", "API key",
                  "Issued by your JustDial account manager — it is not "
                  "self-service from the seller dashboard", secret=True),
            Field("campaign_id", "Campaign / listing ID",
                  "JustDial seller dashboard → your listing", required=False),
        ),
        caution="JustDial PUSHES leads to a URL — there is no key to call them "
                "with. Save this card, then send the webhook URL below to your "
                "JustDial account manager; leads arrive in Graha as contacts.",
        notes=("The webhook URL is the credential: anyone holding it can post a "
               "lead into this organisation. Clear and re-save this card to "
               "rotate it.",),
    ),
    PlatformSpec(
        "indiamart", "IndiaMART", "lead", publishes=False,
        console="https://seller.indiamart.com/leadmanager/crmapi",
        fields=(
            Field("crm_key", "CRM API key",
                  "IndiaMART seller panel → Lead Manager → CRM API → Generate "
                  "key", secret=True),
            Field("mobile", "Registered mobile number",
                  "The number the IndiaMART seller account is registered "
                  "against — the CRM API keys its calls on it",
                  required=False, placeholder="9876543210"),
        ),
        caution="IndiaMART is PULLED, not pushed. Once the CRM key is saved, "
                "enquiries are fetched every 15 minutes — their documented "
                "limit — and land in Graha as contacts.",
        notes=("Leads are matched to an existing contact by IndiaMART's own "
               "query id, then by phone, then by email, so the same person "
               "enquiring twice does not become two rows.",),
    ),
)

SPECS_BY_KEY: dict[str, PlatformSpec] = {s.key: s for s in SPECS}

#: The platforms that can be published TO. `hub_publish.ALL_PLATFORMS` is derived
#: from this so the two cannot drift — a platform on a card here and absent there
#: is a form that saves credentials nothing will ever read.
PUBLISH_PLATFORMS: tuple[str, ...] = tuple(s.key for s in SPECS if s.publishes)

#: Removed deliberately, and named so a reader does not "restore" one.
#: TikTok is banned in India; Telegram and Snapchat were unconnectable and the
#: owner ruled them out rather than leave them erroring.
RETIRED_PLATFORMS: frozenset[str] = frozenset({"tiktok", "telegram", "snapchat"})

#: When each `where` path was last checked against the live console. A stale
#: instruction sends an operator to a page that no longer exists, and they
#: conclude the product is broken rather than the sentence.
WHERE_CHECKED = "2026-08-07"


def spec(platform: str) -> Optional[PlatformSpec]:
    return SPECS_BY_KEY.get(platform)


def redirect_url(platform: str) -> str:
    """The URL to paste into that network's console.

    Built from `BACKEND_URL`, which is the same base `hub_publish.py` builds the
    redirect from at authorize time — so what the card tells an operator to
    paste is literally the string the OAuth request will send. Two independently
    constructed URLs that differ by a trailing slash is a consent error nobody
    can debug from the outside.
    """
    s = spec(platform)
    if not s or not s.redirect_path:
        return ""
    base = os.getenv("BACKEND_URL", "").rstrip("/")
    return f"{base}{s.redirect_path}" if base else ""


# ── Storage ─────────────────────────────────────────────────────────────────

def split_values(platform: str, values: dict) -> tuple[dict, dict]:
    """(public, secret), split by the SPEC rather than by the caller.

    A caller cannot mark a field public and get it stored in clear: whether a
    value is a secret is a property of the field, declared once, next to the
    label the operator reads. Unknown keys are dropped rather than stored — a
    form posting a field the platform does not declare is a bug or an attempt,
    and neither should end up in the row.
    """
    s = spec(platform)
    if not s:
        return {}, {}
    public, secret = {}, {}
    for f in s.fields:
        if f.key not in values:
            continue
        raw = values[f.key]
        val = "" if raw is None else str(raw).strip()
        if not val:
            continue
        (secret if f.secret else public)[f.key] = val
    return public, secret


def seal(secrets: dict) -> tuple[Optional[str], str]:
    """(ciphertext, hint) for a secret bundle.

    The hint is the last four characters of the FIRST declared secret, which is
    the one an operator would recognise. Four is enough to match a value against
    a console and useless on its own.
    """
    if not secrets:
        return None, ""
    blob = encryption.encrypt(json.dumps(secrets, ensure_ascii=False))
    first = next(iter(secrets.values()), "")
    return blob, first[-4:] if len(first) >= 4 else ""


def unseal(ciphertext: Optional[str]) -> dict:
    """The secret bundle, or {} — never a raise.

    A credential row that cannot be decrypted (the key rotated, the row was
    written by another environment) must degrade to "this platform has no
    credentials", which the resolver then falls through on. Raising here would
    turn one bad row into a 500 on a page listing twelve platforms.
    """
    if not ciphertext:
        return {}
    try:
        return json.loads(encryption.decrypt(ciphertext))
    except Exception:                                  # noqa: BLE001 — reported
        log.warning("connector credential could not be decrypted", exc_info=True)
        return {}


def public_view(platform: str, row: Optional[dict]) -> dict:
    """What the browser is allowed to know about a saved row.

    Built from the SPEC outward rather than from the row inward, so a secret
    field added tomorrow is redacted by default. There is no code path in this
    module that puts a decrypted value into a response.
    """
    s = spec(platform)
    row = row or {}
    public = row.get("public_fields") or {}
    if isinstance(public, str):
        try:
            public = json.loads(public)
        except ValueError:
            public = {}
    return {
        "platform": platform,
        "label": s.label if s else platform,
        "kind": s.kind if s else "oauth",
        "publishes": bool(s.publishes) if s else True,
        "console": s.console if s else "",
        "caution": s.caution if s else "",
        "notes": list(s.notes) if s else [],
        # How the app that fills this form is CREATED. `notes` assumes it
        # already exists, which is the one assumption a first-time operator
        # cannot satisfy. See `services/connector_setup.py`.
        "setup_steps": connector_setup.short_steps(platform),
        "redirect_url": redirect_url(platform),
        "fields": [
            {"key": f.key, "label": f.label, "where": f.where, "secret": f.secret,
             "required": f.required, "placeholder": f.placeholder, "help": f.help,
             # A secret is never echoed. A public field is, because the operator
             # has to be able to see what is saved without retyping it.
             "value": "" if f.secret else str(public.get(f.key, "")),
             "saved": bool(row.get("secrets_encrypted")) if f.secret
                      else bool(public.get(f.key)),
             }
            for f in (s.fields if s else ())
        ],
        "has_secret": bool(row.get("secrets_encrypted")),
        "secret_hint": row.get("secret_hint") or "",
        "is_active": bool(row.get("is_active")),
        "scope": ("client" if row.get("client_id") else "org") if row.get("id") else "",
        "last_tested_at": row.get("last_tested_at"),
        "last_test_ok": row.get("last_test_ok"),
        "last_test_detail": row.get("last_test_detail") or "",
        "where_checked": WHERE_CHECKED,
    }


# ── Resolution ──────────────────────────────────────────────────────────────

@dataclass
class Resolved:
    """Which app answered, and where it came from.

    `source` is returned rather than inferred because it is the answer to the
    only question anyone asks when a connector misbehaves: whose app was this?
    """
    platform: str
    values: dict = field(default_factory=dict)
    source: str = "none"        # "client" | "org" | "env" | "none"

    def __bool__(self) -> bool:
        return bool(self.values)


async def resolve(pool, org_id: str, platform: str, client_id: Optional[str] = None) -> Resolved:
    """This client's app, else the org's, else the environment variable.

    The order is the owner's, and step three is what makes this change safe to
    deploy: every platform nobody has filled a form in for keeps reading exactly
    the environment variable `routers/hub_publish.py` reads today.

    Only ACTIVE rows count. A half-filled form left mid-edit must not take
    precedence over a working default — which is what `is_active` defaulting to
    FALSE is for.
    """
    s = spec(platform)
    if not s:
        return Resolved(platform)

    rows = await pool.fetch(
        "SELECT id, client_id::text AS client_id, public_fields, secrets_encrypted "
        "  FROM public.hub_connector_credentials "
        " WHERE org_id=$1::uuid AND platform=$2 AND is_active=TRUE "
        "   AND (client_id IS NULL OR client_id=$3::uuid)",
        org_id, platform, client_id,
    )
    by_scope = {("client" if r["client_id"] else "org"): r for r in rows}

    for scope in ("client", "org"):
        row = by_scope.get(scope)
        if not row:
            continue
        public = row["public_fields"]
        if isinstance(public, str):
            public = json.loads(public or "{}")
        values = {**(public or {}), **unseal(row["secrets_encrypted"])}
        if values:
            return Resolved(platform, values, scope)

    # The environment, last. Mapped through `hub_publish.OAUTH_CONFIGS` so there
    # is ONE statement of which variable belongs to which platform, rather than
    # a second copy here that drifts from it.
    from routers.hub_publish import OAUTH_CONFIGS
    cfg = OAUTH_CONFIGS.get(platform) or {}
    env_values = {}
    if cfg.get("env_id") and os.getenv(cfg["env_id"]):
        env_values[_primary_public_key(s)] = os.getenv(cfg["env_id"], "")
    if cfg.get("env_secret") and os.getenv(cfg["env_secret"]):
        env_values[_primary_secret_key(s)] = os.getenv(cfg["env_secret"], "")
    if env_values:
        return Resolved(platform, env_values, "env")

    return Resolved(platform)


def _primary_public_key(s: PlatformSpec) -> str:
    for f in s.fields:
        if not f.secret:
            return f.key
    return "client_id"


def _primary_secret_key(s: PlatformSpec) -> str:
    for f in s.fields:
        if f.secret:
            return f.key
    return "client_secret"


def missing_fields(platform: str, values: dict) -> list[str]:
    """The required fields still empty. Used by the activate path and by Test.

    A card cannot be switched on half-filled, because a half-filled credential
    that outranks a working default is an outage with no error message.
    """
    s = spec(platform)
    if not s:
        return []
    return [f.label for f in s.fields if f.required and not str(values.get(f.key, "")).strip()]
