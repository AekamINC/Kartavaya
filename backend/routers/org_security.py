"""
org_security.py — `GET/PATCH /v1/org/security`.

`TabSecurity.jsx` renders every control disabled and states the reason:

    "`GET/PATCH /v1/org/security` and the `org_security` table are both listed
    as new work in `10-org-settings.md` §4 and neither exists. Nor does
    two-factor authentication anywhere in the product."

ALL THREE CLAIMS VERIFIED HELD at 2a2a27b:
  · no route matched `/v1/org/security`;
  · `to_regclass('staging.org_security')` is NULL in the live database;
  · `grep -rniE 'totp|pyotp|two_factor|twofactor|mfa_|otpauth|authenticator'`
    over `backend/` returns NOTHING. Zero hits. There is no TOTP secret, no
    enrolment flow and no verification step.

ONE CLAIM IN THAT HEADER IS STALE, and it matters here: "Sign-in security is
currently what Supabase Auth provides." It is not. `auth_router.py` mints its
own JWT (`_create_token`, `sub` = a `user_...` id) against `public.users`, which
holds its own `password_hash`/`salt`. Verified in the live database:
`auth.users` holds 0 rows and `public.users` holds 12. Supabase Auth is
provisioned and unused.

That is not a nitpick. It rules out the one shortcut available for the 2FA
count: `auth.mfa_factors` exists (Supabase creates it for every project) but
keys on `auth.users.id`, and no row in it can ever correspond to a
`user_...` id. There is no join. Enrolment is therefore genuinely uncountable
until this product grows its own TOTP store, which is exactly what the control
says, so the control is right and stays refused — see §2.

UPDATE 2026-08-23 (workstream L): both stale claims above are now false, in
the direction this file always said they would need to move. `staging.
org_security` exists (migration 207) and `staging.user_totp` exists
(migration 208, one of the exact `TOTP_TABLES` names below) — actual TOTP
enrolment, verification and hashed single-use recovery codes ship in
`services/totp.py`, `routers/totp.py` (`/api/v1/me/2fa/*`) and
`auth_router.py` (`login()` branches to a 2FA challenge; `verify_2fa()`
completes it). `_enrolment()` below needed no code change to start counting
real enrolment, exactly as designed. What is NEW beyond storage: login now
actually REFUSES a member of an org with `tfa_enforced=true` who has no
confirmed row in `staging.user_totp` — see `auth_router.py login()` — so
`tfa_enforced` is enforced at the point an org_owner would expect it to be,
even though `idle_timeout`/`ip_ranges`/`password_policy` remain stored-only
exactly as before.

═══════════════════════════════════════════════════════════════════════════════
1 · WHAT THIS ENDPOINT DOES AND DOES NOT DO
═══════════════════════════════════════════════════════════════════════════════

It STORES the policy. It does not yet ENFORCE it: nothing reads `ip_ranges` on
the request path, nothing expires a session on `idle_timeout`, and nothing
checks `password_policy` at signup. Building those is three separate changes in
`auth_router.py` and the middleware stack, which this file does not own.

So every response carries `enforced: false` per control. A settings page that
shows a saved IP allowlist while the API accepts every address is a page that
tells the customer they are protected when they are not — the same class of lie
the disabled toggles were built to avoid. The value is stored honestly and
reported as inert until the enforcement lands.

═══════════════════════════════════════════════════════════════════════════════
2 · CONSTRAINT ONE — 2FA ENFORCE NEEDS A LOCKOUT COUNT
═══════════════════════════════════════════════════════════════════════════════

    "Turning on 'require 2FA for all members' when 6 of 14 people have no
    authenticator locks out 6 people immediately. The control must state the
    number and stay disabled until that number is knowable, or the first use of
    the feature is an outage."

Enforced server-side, not by disabling a switch:

  · `_enrolment(...)` probes for an app-owned TOTP store. While none exists the
    count is `None` and `countable` is false.
  · PATCH with `tfa_enforced: true` is REFUSED with 409 while the count is not
    knowable. The refusal names why.
  · Once a store exists the probe finds it and the rule becomes the real one:
    the request must carry `acknowledge_lockout` equal to the exact number of
    members who would be locked out. Not a boolean — the number. A caller that
    has not read the count cannot guess it, and a caller whose count is stale
    because someone enrolled in the meantime is told so rather than proceeding.
  · `tfa_enforced` cannot be true while `tfa_allowed` is false. Requiring what
    is not permitted locks out everyone, including whoever saved it.

The probe is `to_regclass`, so the day a TOTP table lands this starts working
with no code change here.

═══════════════════════════════════════════════════════════════════════════════
3 · CONSTRAINT TWO — IP RANGES VALIDATE AGAINST THE SAVING ADMIN
═══════════════════════════════════════════════════════════════════════════════

    "Saving a range that excludes the browser you are saving from locks the
    organisation out of its own settings, with no path back except support.
    Check before save, and refuse."

Implemented in `_check_admin_inside`. A non-empty list is refused unless the
caller's own address falls inside one of the ranges, and the refusal quotes the
address so the admin can paste it in. An EMPTY list is always allowed — that is
the only way back from a mistake, so it must never be gated.

Three edge cases that are the actual bug, not the happy path:

  · **Address family.** An IPv6 caller with only IPv4 ranges is outside all of
    them. `ipaddress` gets this right and the save is refused, which is correct
    and is precisely the lockout a hand-rolled string comparison would let
    through.
  · **Unknown address.** If neither `X-Forwarded-For` nor `request.client` gives
    a parseable address, a non-empty list is refused outright. We cannot prove
    the admin is inside, so we do not let them bet the org on it. Fail closed.
  · **`X-Forwarded-For` is client-controlled.** Trusting it here is safe in the
    one direction that matters: it is used ONLY to decide whether to REFUSE a
    save. Spoofing it cannot grant access to anything; the worst a forged header
    achieves is locking the forger out. If this value is ever used to admit a
    request, that reasoning stops holding and the header must be taken from the
    proxy instead.

═══════════════════════════════════════════════════════════════════════════════
4 · WHO MAY WRITE — org_owner
═══════════════════════════════════════════════════════════════════════════════

Read is org_admin + org_owner, matching the rest of organisation settings.
Write is org_owner alone: every control on this screen is capable of locking
members out, and the RBAC model already puts "what an org_admin can reach" in
the owner's hands. Narrower is the safe direction and is easy to widen later;
the reverse is not.

`require_org_role` also admits `platform_admin` unconditionally — god mode,
existing behaviour on every org-scoped route, and the support path that recovers
an org that has locked itself out.

═══════════════════════════════════════════════════════════════════════════════
5 · THE TABLE MAY NOT EXIST
═══════════════════════════════════════════════════════════════════════════════

`migrations/PROPOSED_069_org_security.sql` is proposed, not applied — staging
and production share one Supabase project. So this router probes for the table:
GET returns defaults with `storage_ready: false`, and PATCH returns 503 naming
the migration rather than 500ing on a missing relation. Mounting this router
before the migration runs is therefore safe.
"""
import ipaddress
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.role_tiers import ORG_SETTINGS_ROLES, ORG_OWNER_ONLY
from services.audit import emit as audit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/org/security", tags=["org-security"])


# ── Policy vocabulary ─────────────────────────────────────────────────────────

#: The two the design offers. A third value would be a policy nothing
#: implements, so it is rejected rather than stored.
PASSWORD_POLICIES: tuple[str, ...] = ("standard", "strong")

#: Minutes. `None` means never. The design's select offers 30 / 120 / 480; the
#: bound is wider than the select because a custom value is a reasonable future
#: control and a too-narrow bound would reject it, while a bound of "any int"
#: would accept 0 — an idle timeout of zero signs everyone out instantly.
IDLE_TIMEOUT_MIN = 5
IDLE_TIMEOUT_MAX = 43_200  # 30 days

#: More than this is not a policy, it is a paste. Kept small deliberately: the
#: column is read on every request once enforcement exists.
MAX_IP_RANGES = 50

#: Where an app-owned TOTP enrolment store would live. NONE OF THESE EXIST —
#: see the module docstring. Listed rather than assumed so that whoever builds
#: two-factor only has to match one of these names for the lockout count, and
#: this endpoint, to start working.
#:
#: `auth.mfa_factors` is deliberately absent: it keys on `auth.users.id` and
#: this product's users are rows in `public.users` with `user_...` ids. There is
#: no join, so counting it would count zero and call it knowable.
TOTP_TABLES: tuple[str, ...] = ("user_totp", "user_mfa_factors")

DEFAULTS: dict = {
    # Permissive by default because nothing enforces it yet; the honest default
    # is "the behaviour you have today", not a stricter one that is fiction.
    "tfa_allowed": True,
    "tfa_enforced": False,
    "idle_timeout": None,
    "ip_ranges": [],
    "password_policy": "standard",
}


# ── Storage probe ─────────────────────────────────────────────────────────────

_table_present: bool | None = None
_totp_table: str | None | bool = False  # False = not yet probed


async def _storage_ready(pool) -> bool:
    """Does `staging.org_security` exist? Cached once it does."""
    global _table_present
    if _table_present:
        return True
    _table_present = bool(
        await pool.fetchval("SELECT to_regclass('org_security')")
    )
    return _table_present


async def _totp_store(pool) -> str | None:
    """The app-owned TOTP table, or None. Cached once one is found."""
    global _totp_table
    if _totp_table is not False and _totp_table is not None:
        return _totp_table  # type: ignore[return-value]
    for name in TOTP_TABLES:
        if await pool.fetchval("SELECT to_regclass($1)", name):
            _totp_table = name
            return name
    _totp_table = None
    return None


# ── 2FA enrolment ─────────────────────────────────────────────────────────────

async def _enrolment(pool, org_id: str) -> dict:
    """
    How many members would be locked out by requiring 2FA right now.

    `countable` false means the answer is unknown, NOT zero. The difference is
    the entire constraint: zero would let the switch through and lock out
    everybody.
    """
    members = await pool.fetchval(
        "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
        "WHERE org_id=$1::uuid "
        "AND role_code IN ('org_owner','org_admin','org_member')",
        org_id,
    ) or 0

    store = await _totp_store(pool)
    if not store:
        return {
            "countable": False,
            "members": members,
            "enrolled": None,
            "would_be_locked_out": None,
            "reason": (
                "This product has no two-factor enrolment. There is no TOTP "
                "secret, enrolment flow or verification step anywhere in the "
                "API, so the number of members who would be locked out cannot "
                "be counted — and it is not zero."
            ),
        }

    # `store` is one of TOTP_TABLES, never caller input, so interpolating it is
    # safe. Parameterising a table name is not possible in Postgres.
    enrolled = await pool.fetchval(
        f"SELECT COUNT(DISTINCT t.user_id) FROM {store} t "  # noqa: S608 - fixed allowlist
        "JOIN staging.user_roles ur ON ur.user_id = t.user_id "
        "WHERE ur.org_id=$1::uuid "
        "AND ur.role_code IN ('org_owner','org_admin','org_member')",
        org_id,
    ) or 0
    return {
        "countable": True,
        "members": members,
        "enrolled": enrolled,
        "would_be_locked_out": max(0, members - enrolled),
        "reason": None,
    }


# ── IP handling ───────────────────────────────────────────────────────────────

def _client_ip(request: Request):
    """
    The caller's address, or None.

    Leftmost `X-Forwarded-For` first — Railway terminates TLS at a proxy, so
    `request.client.host` is the proxy there and validating against it would
    check the wrong machine. See §3 of the module docstring for why trusting a
    client-controlled header is safe in this one direction.
    """
    raw = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if not raw and request.client:
        raw = (request.client.host or "").strip()
    if not raw:
        return None
    # Strip a bracketed IPv6 host and any :port suffix, both of which appear in
    # forwarded headers and neither of which ip_address accepts.
    if raw.startswith("["):
        raw = raw[1:].split("]")[0]
    elif raw.count(":") == 1:
        raw = raw.split(":")[0]
    try:
        return ipaddress.ip_address(raw)
    except ValueError:
        return None


def _parse_ranges(values: list[str]) -> list[str]:
    """Normalise and validate CIDRs. Raises 400 naming the offending entry."""
    if len(values) > MAX_IP_RANGES:
        raise HTTPException(
            400, f"At most {MAX_IP_RANGES} IP ranges. {len(values)} were given.",
        )
    out: list[str] = []
    for raw in values:
        text = (raw or "").strip()
        if not text:
            continue  # a blank line in a textarea is not an error
        try:
            # strict=False so "203.0.113.5/24" is accepted and normalised to its
            # network rather than rejected for host bits. The normalised form is
            # returned to the caller so nothing is stored that they cannot see.
            net = ipaddress.ip_network(text, strict=False)
        except ValueError as exc:
            raise HTTPException(
                400, f"'{text}' is not a valid IP address or CIDR range: {exc}",
            ) from exc
        normalised = str(net)
        if normalised not in out:
            out.append(normalised)
    return out


def _check_admin_inside(ranges: list[str], caller) -> None:
    """
    Refuse a list that would lock out the address doing the saving.

    An empty list is the way back from a mistake and is always allowed.
    """
    if not ranges:
        return
    if caller is None:
        raise HTTPException(
            400,
            "Your own IP address could not be determined, so this range list "
            "cannot be checked against it. Saving it could lock this "
            "organisation out of its own settings, so it is refused. Clear the "
            "list to remove the restriction.",
        )
    for r in ranges:
        if caller in ipaddress.ip_network(r):
            return
    raise HTTPException(
        400,
        f"Your current address ({caller}) is not inside any of these ranges "
        f"({', '.join(ranges)}), so saving them would lock you — and anyone "
        "else on this network — out of this organisation immediately. Add a "
        "range that contains your address, or clear the list.",
    )


# ── Body ──────────────────────────────────────────────────────────────────────

class SecurityPatch(BaseModel):
    tfa_allowed: bool | None = None
    tfa_enforced: bool | None = None
    #: Minutes, or null for never.
    idle_timeout: int | None = None
    ip_ranges: list[str] | None = None
    password_policy: str | None = None

    #: The exact number of members who would lose access when `tfa_enforced`
    #: goes true. Must equal the server's own count. A boolean "yes I'm sure"
    #: can be sent by a client that never displayed the number; a matching
    #: integer cannot.
    acknowledge_lockout: int | None = None


# ── Read ──────────────────────────────────────────────────────────────────────

async def _load(pool, org_id: str) -> dict:
    if not await _storage_ready(pool):
        return dict(DEFAULTS)
    row = await pool.fetchrow(
        "SELECT tfa_allowed, tfa_enforced, idle_timeout, ip_ranges, "
        "password_policy FROM staging.org_security WHERE org_id=$1::uuid",
        org_id,
    )
    if not row:
        return dict(DEFAULTS)
    d = dict(row)
    d["ip_ranges"] = list(d.get("ip_ranges") or [])
    return d


@router.get("")
async def get_security(
    request: Request,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """The org's security policy, plus everything a client needs to render the
    two constrained controls truthfully."""
    pool = await get_pool()
    settings = await _load(pool, org_id)
    enrolment = await _enrolment(pool, org_id)
    caller = _client_ip(request)
    ready = await _storage_ready(pool)

    return {
        **settings,
        "storage_ready": ready,
        "storage_note": None if ready else (
            "staging.org_security does not exist yet, so these are the "
            "defaults and nothing can be saved. Apply "
            "migrations/207_org_security.sql."
        ),
        "two_factor": {
            **enrolment,
            # The switch's own precondition, computed here so a client never has
            # to re-derive it and get it wrong.
            "enforce_available": bool(
                enrolment["countable"] and settings.get("tfa_allowed")
            ),
        },
        # Stated per control. `tfa_allowed`/`tfa_enforced` are the two that
        # became real (workstream L, 2026-08-23): `auth_router.py login()`
        # reads `tfa_enforced` and refuses an unenrolled member. The other
        # three are still stored only — no middleware reads `ip_ranges`, no
        # session expires on `idle_timeout`, signup does not read
        # `password_policy`.
        "enforced": {
            "tfa_allowed": True,
            "tfa_enforced": True,
            "idle_timeout": False,
            "ip_ranges": False,
            "password_policy": False,
        },
        "enforcement_note": (
            "tfa_allowed/tfa_enforced are read at login (auth_router.py) and "
            "actually gate sign-in. idle_timeout, ip_ranges and "
            "password_policy remain stored but not applied: no middleware "
            "reads ip_ranges, no session expires on idle_timeout, and signup "
            "does not read password_policy. Sign-in is the JWT and password "
            "hash in auth_router.py over public.users — not Supabase Auth, "
            "which is provisioned and unused."
        ),
        # So the admin can see what the allowlist will be checked against
        # BEFORE they type a range, rather than discovering it in an error.
        "your_ip": str(caller) if caller else None,
        "password_policies": list(PASSWORD_POLICIES),
    }


# ── Write ─────────────────────────────────────────────────────────────────────

@router.patch("")
async def patch_security(
    body: SecurityPatch,
    request: Request,
    user=Depends(require_org_role(*ORG_OWNER_ONLY)),
    org_id: str = Depends(get_org_id),
):
    """Save the org's security policy. Refuses any save that would lock the
    saving admin — or the whole organisation — out."""
    pool = await get_pool()

    fields = body.dict(exclude_unset=True)
    fields.pop("acknowledge_lockout", None)
    if not fields:
        raise HTTPException(400, "Nothing to update")

    if not await _storage_ready(pool):
        raise HTTPException(
            503,
            "Security settings cannot be saved yet: staging.org_security does "
            "not exist. Apply migrations/PROPOSED_069_org_security.sql, then "
            "retry. Nothing was saved.",
        )

    current = await _load(pool, org_id)
    merged = {**current, **fields}

    # ── Validate every field before writing any of them ──────────────────────
    if "password_policy" in fields and merged["password_policy"] not in PASSWORD_POLICIES:
        raise HTTPException(
            400,
            f"'{merged['password_policy']}' is not a password policy. "
            f"Valid: {', '.join(PASSWORD_POLICIES)}.",
        )

    if "idle_timeout" in fields and merged["idle_timeout"] is not None:
        t = merged["idle_timeout"]
        if not isinstance(t, int) or isinstance(t, bool):
            raise HTTPException(400, "idle_timeout must be a whole number of minutes, or null for never")
        if t < IDLE_TIMEOUT_MIN or t > IDLE_TIMEOUT_MAX:
            raise HTTPException(
                400,
                f"idle_timeout must be between {IDLE_TIMEOUT_MIN} and "
                f"{IDLE_TIMEOUT_MAX} minutes, or null for never.",
            )

    if "ip_ranges" in fields:
        merged["ip_ranges"] = _parse_ranges(fields["ip_ranges"] or [])
        _check_admin_inside(merged["ip_ranges"], _client_ip(request))

    # 2FA. Order matters: allowed is settled first, because enforce depends on
    # the value it is ABOUT to have, not the one it had.
    if merged["tfa_enforced"] and not merged["tfa_allowed"]:
        raise HTTPException(
            400,
            "Two-factor authentication cannot be required while it is not "
            "allowed — that locks out every member including you. Allow it "
            "first, give people time to enrol, then require it.",
        )

    turning_on = bool(merged["tfa_enforced"]) and not bool(current.get("tfa_enforced"))
    if turning_on:
        enrolment = await _enrolment(pool, org_id)
        if not enrolment["countable"]:
            raise HTTPException(
                409,
                "Two-factor authentication cannot be required yet: "
                + (enrolment["reason"] or "the lockout count is unknown.")
                + " Requiring it now would sign out every member of this "
                "organisation with no way back in.",
            )
        locked = enrolment["would_be_locked_out"]
        if locked and body.acknowledge_lockout != locked:
            raise HTTPException(
                409,
                f"{locked} of {enrolment['members']} members have no "
                "authenticator and would lose access immediately. To proceed, "
                f"resend this request with acknowledge_lockout={locked}. "
                "Nothing was saved.",
            )

    # ── Write ────────────────────────────────────────────────────────────────
    row = await pool.fetchrow(
        "INSERT INTO staging.org_security "
        "(org_id, tfa_allowed, tfa_enforced, idle_timeout, ip_ranges, "
        " password_policy, updated_by, updated_at) "
        "VALUES ($1::uuid, $2, $3, $4, $5::text[], $6, $7, NOW()) "
        "ON CONFLICT (org_id) DO UPDATE SET "
        "tfa_allowed=EXCLUDED.tfa_allowed, tfa_enforced=EXCLUDED.tfa_enforced, "
        "idle_timeout=EXCLUDED.idle_timeout, ip_ranges=EXCLUDED.ip_ranges, "
        "password_policy=EXCLUDED.password_policy, "
        "updated_by=EXCLUDED.updated_by, updated_at=NOW() "
        "RETURNING tfa_allowed, tfa_enforced, idle_timeout, ip_ranges, password_policy",
        org_id,
        bool(merged["tfa_allowed"]),
        bool(merged["tfa_enforced"]),
        merged["idle_timeout"],
        list(merged["ip_ranges"] or []),
        merged["password_policy"],
        user["user_id"],
    )

    changed = sorted(k for k in fields if current.get(k) != merged.get(k))
    if changed:
        audit(
            "org.security_updated",
            request,
            org_id=org_id,
            user_id=user["user_id"],
            resource_type="org_security",
            resource_id=org_id,
            detail={"changed": changed, "ip_range_count": len(merged["ip_ranges"] or [])},
            severity="warn",
        )
        # `staging.audit_log` does not exist yet (060 unapplied), so the call
        # above is currently swallowed. Log locally too rather than lose a
        # security-policy change entirely.
        log.info(
            "org_security updated org=%s by=%s changed=%s",
            org_id, user["user_id"], json.dumps(changed),
        )

    out = dict(row)
    out["ip_ranges"] = list(out.get("ip_ranges") or [])
    return {"status": "updated", "changed": changed, **out}
