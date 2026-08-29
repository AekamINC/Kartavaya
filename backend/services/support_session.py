"""support_session.py — request, approve, deny and revoke a platform support session.

THE RULE THAT OUTRANKS EVERYTHING ELSE IN THIS FILE: SUPPORT ACCESS IS NEVER
SILENT. `design-handover/11-platform-admin.md` states it that way, and here it
is a shape rather than a sentence — `open_session` writes the customer's audit
row and mails the customer's owner INSIDE the transaction that grants the
access, so if either fails the grant does not happen. There is no `try/except`
around either one, and adding one would be the exact defect this module was
written to prevent.

That is why this module does NOT import `services.audit`. `audit.emit` is
`asyncio.ensure_future` over a `_write` that ends in
`except Exception: log.warning(...)` — correct for a per-request access trail,
and completely wrong for the three rows that record an authorisation CHANGING.
A best-effort INSERT cannot be inside a transaction it is supposed to be able to
roll back. The audit writes below are plain awaited INSERTs on the same
connection.

── STATES ARE DERIVED, NEVER STORED ─────────────────────────────────────────

`migrations/111_platform_support_sessions.sql` refuses a `status` column and
argues it at length: a stored status is a cache of a clock, its failure mode is
staleness, and a stale AUTHORISATION cache means somebody has access they should
not have and nothing on screen looks wrong. Five states, all of them names for
shapes of timestamps:

  requested   approved_at IS NULL AND denied_at IS NULL          grants NOTHING
  denied      denied_at IS NOT NULL              TERMINAL        grants NOTHING
  active      approved, not denied, not revoked, clock in the
              future or absent                                   THE ONLY GRANT
  expired     approved, not revoked, expires_at <= NOW()
                                                 TERMINAL BY CLOCK  grants NOTHING
  revoked     revoked_at IS NOT NULL             TERMINAL        grants NOTHING

`expired` has no writer, no sweeper and no row change. It is a comparison inside
`staging.v_active_support_sessions`, evaluated at read time, so a session leaves
the grant the instant its clock passes and there is nothing that can be late,
fail, or be dropped in a refactor.

── SELF-APPROVAL IS REFUSED. SELF-DENIAL IS NOT. ────────────────────────────

Denying yourself removes access; approving yourself creates it. Only one of
those is an escalation, so `deny_session` permits the requester (it is a
withdrawal) and `open_session` refuses them by name.

── THERE IS NO EXTENSION, AND THAT IS DELIBERATE ────────────────────────────

No `extended_at`, no `extended_by`, and after approval the ONLY UPDATE the row
ever takes is the revocation triple. Three reasons:

  (a) An extension destroys the evidence the schema exists to keep. 111 keeps
      `requested_ttl_hours` AND `granted_ttl_hours` precisely so a customer who
      SHORTENED a request can be seen to have done so. Overwrite
      `granted_ttl_hours` and afterwards nothing on the row says the customer
      ever approved two hours.
  (b) It makes the countdown a lie. A number that moves under the reader is
      worse than no number.
  (c) The honest version already exists and costs nothing:
      `idx_pss_one_pending_per_agent_per_org` is partial on the UNDECIDED state
      only, so a second request can be raised while the first is still live. A
      new request is a new ref, a new reason, a new decision, a new audit row
      and a new email — a fresh consent rather than a silently lengthened one.

An almost-append-only authorisation table is one an auditor can read.

── EVERYTHING MUST WORK WITH THE TABLE ABSENT ───────────────────────────────

Every READ path here answers "no sessions" on `_STORE_ABSENT` — 42P01, the table
gone, AND 3F000, the whole schema gone, which is a different sqlstate and a
different exception class — one warning per process, then silence. Every WRITE
path answers 503 with the migration named, because "your approval silently did
nothing" is the worst possible answer to a customer pressing Approve.

111 IS APPLIED, AND THIS FILE SAID OTHERWISE FOR A FORTNIGHT. Measured against
the live catalogue on 2026-08-21 (project toacecaewujfxjfrjwco,
`railway run -e staging -s Kartavya`, SELECT only):

    to_regclass('staging.platform_support_sessions')  -> present
    to_regclass('staging.v_active_support_sessions')  -> present,
                                                        {security_invoker=true}
    count(*) FROM staging.platform_support_sessions   -> 0
    count(*) FROM staging.v_active_support_sessions   -> 0
    all six indexes and all ten named CHECK constraints -> present

`migrations/111_platform_support_sessions.sql`'s own header still says NOT
APPLIED AS OF 6 August 2026, which was true on the day it was written and has
not been true since. THE ABSENT-TABLE HANDLING BELOW STAYS ANYWAY, and not out
of sentiment: `migrations/182_org_initiated_support_requests.sql` — the table
section 0 writes to — genuinely is unapplied, the two are applied
independently, and a deployment where one exists and the other does not is the
normal state during any rollout. A read path that 500s on a missing table is a
settings page that breaks on a migration nobody has run yet.
"""
import logging
import os
import secrets

import asyncpg

log = logging.getLogger(__name__)

#: Crockford-ish, no I and no O: SUP-I0OI is not a thing anybody can dictate
#: correctly, and the ref exists to be read down a phone line. Mirrors 111's
#: CHECK (ref ~ '^SUP-[0-9A-HJ-NP-Z]{6}$') — the two must agree or every insert
#: fails at the constraint.
_REF_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"

#: The four durations. 0 means UNTIL REVOKED and is the ONLY value that leaves
#: an approved row with a NULL `expires_at`; every reader must treat that NULL
#: as LIVE and not as expired.
TTL_CHOICES: tuple[int, ...] = (0, 2, 24, 168)

#: RBAC-SPEC:19 caps a support session BELOW admin. The platform tier is ADMIN
#: everywhere else in the product and the whole purpose of a session is to
#: narrow that, so a third value here is the feature inverted.
ACCESS_LEVELS: tuple[str, ...] = ("viewer", "editor")

#: 111's `pss_reason_is_substantive`. Restated here so the endpoint refuses with
#: a sentence instead of letting a CHECK violation surface as a 500.
MIN_REASON_LENGTH = 12

_TABLE_ABSENT_LOGGED = False


class SupportSessionError(Exception):
    """A refusal with the status the router should answer.

    Carries its own status because the refusals are genuinely different answers:
    a malformed request is 400, "you may not approve your own request" is 403,
    "somebody already decided this" is 409, and "the migration is unapplied" is
    503. A bare string would let each call site pick, which is how neighbouring
    conditions in one loop come to answer 400 and 403.
    """

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def new_ref() -> str:
    """SUP-XXXXXX. `secrets`, not `random`: this token names an authorisation."""
    return "SUP-" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(6))


#: "The store is not there", in BOTH the shapes Postgres reports it.
#:
#: `42P01` / UndefinedTableError is the relation missing. `3F000` /
#: InvalidSchemaNameError is THE SCHEMA missing — and Postgres raises that
#: BEFORE it ever looks for the relation, so it is not a subclass of the first
#: and `except asyncpg.UndefinedTableError` lets it straight out as a 500.
#: Every handler below means "absent" in the sense of the section header above,
#: which a dropped schema satisfies at least as completely as a dropped table.
_STORE_ABSENT = (asyncpg.UndefinedTableError, asyncpg.InvalidSchemaNameError)


def _absent(exc: BaseException) -> bool:
    return isinstance(exc, _STORE_ABSENT)


def _note_absent() -> None:
    global _TABLE_ABSENT_LOGGED
    if not _TABLE_ABSENT_LOGGED:
        _TABLE_ABSENT_LOGGED = True
        log.warning(
            "public.platform_support_sessions is absent — migration 111 is "
            "unapplied, so there are no support sessions. Logged once."
        )


_UNAPPLIED = (
    "Support sessions are not available on this deployment. "
    "migrations/111_platform_support_sessions.sql has not been applied."
)


# ═════════════════════════════════════════════════════════════════════════════
# Validation — pure, so it is testable without a database and cannot be skipped
# by a branch.
# ═════════════════════════════════════════════════════════════════════════════

def validate_request(
    *, reason: str, modules, access_level: str, ttl_hours: int, requestable
) -> None:
    """Refuse a request that could not mean anything. Raises SupportSessionError.

    `requestable` is `org_resolver.SUPPORT_REQUESTABLE_MODULES` — passed in
    rather than imported so this function stays pure and so the ONE list of
    modules a session may name lives next to the ONE list of paths it may reach.
    A module accepted here that the resolver has no prefix for would be a grant
    the customer reads on an approval screen and that reaches nothing.
    """
    if not reason or len(reason.strip()) < MIN_REASON_LENGTH:
        raise SupportSessionError(
            400,
            f"Say why, in at least {MIN_REASON_LENGTH} characters. The customer "
            "is deciding whether to let a stranger into their records, and a "
            "notice that says nothing is worse than no notice.",
        )

    mods = list(modules or ())
    if not mods:
        raise SupportSessionError(
            400, "Name at least one module. A session with no modules reaches nothing."
        )
    unknown = [m for m in mods if m not in requestable]
    if unknown:
        raise SupportSessionError(
            400,
            f"A support session cannot be requested for: {', '.join(sorted(unknown))}. "
            "Payroll, personnel files and attendance photographs are never in scope.",
        )
    if len(set(mods)) != len(mods):
        raise SupportSessionError(400, "Each module may be named once.")

    if access_level not in ACCESS_LEVELS:
        raise SupportSessionError(
            400,
            f"access_level must be one of: {', '.join(ACCESS_LEVELS)}. "
            "A support session is capped below admin.",
        )

    if ttl_hours not in TTL_CHOICES:
        raise SupportSessionError(
            400,
            f"duration must be one of: {', '.join(str(t) for t in TTL_CHOICES)} "
            "(0 means until revoked).",
        )


# ═════════════════════════════════════════════════════════════════════════════
# The audit row, written INSIDE the caller's transaction.
# ═════════════════════════════════════════════════════════════════════════════

_AUDIT_SQL = """
    INSERT INTO public.audit_log
           (org_id, user_id, action, resource_type, resource_id, detail, severity)
    VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7)
"""

#: The two things this module records, kept apart. `support_session` is a GRANT
#: — requested, approved, denied, revoked. `support_request` is the customer
#: ASKING, which grants nothing. They carry different ref prefixes (SUP- and
#: ASK-) and a reader filtering the audit log on one must not get the other.
_RESOURCE_SESSION = "support_session"
_RESOURCE_REQUEST = "support_request"


async def _audit(conn, *, org_id, user_id, action, ref, detail, severity="warn",
                 resource_type: str = _RESOURCE_SESSION):
    """NOT BEST-EFFORT. No try/except, and this is the point of the whole module.

    Written on the SAME connection inside the SAME transaction as the state
    change, so a failure here rolls the state change back. `severity='warn'`
    because these three events are exactly what somebody auditing this feature
    is looking for; burying them at `info` among the routine rows would make the
    trail unreadable, which is its own security regression.

    It writes into the CUSTOMER'S audit log — `org_id` is the customer's org, so
    it lands in the log they can read, which is what "the customer is told"
    means beyond the email.
    """
    import json

    await conn.execute(
        _AUDIT_SQL, org_id, user_id, action, resource_type, ref,
        json.dumps(detail), severity,
    )


# ═════════════════════════════════════════════════════════════════════════════
# Who is told, and how
# ═════════════════════════════════════════════════════════════════════════════

async def resolve_owner_recipient(conn, org_id: str) -> tuple[str, str, bool]:
    """(email, display_name, no_owner_fallback) for the org this session is in.

    OWNER IF ANY, ELSE THE ORGANISATION'S OWN ADDRESS. 111's closing note
    resolves the recipient as `user_roles WHERE org_id=$1 AND
    role_code='org_owner'` and that rule CANNOT SERVE THE ONE PAYING CUSTOMER.
    Measured 2026-08-06 and recorded in `role_tiers.refuse_grant`'s docstring:
    Unicode Group (fae87907) holds FOUR `org_admin` rows, one `org_member` and
    ZERO `org_owner`, and nothing in this backend can write an `org_owner` row
    into an existing org — `org_members.update_member_role` accepts only
    org_admin/org_member, `admin_orgs.assign_role` narrows to `org_admin`, and
    `org_invites._assert_may_grant_role` lets only an owner invite an owner.

    Owner-only would therefore make every support session for that customer
    impossible to approve, because `pss_approval_and_owner_email_are_one_act`
    makes `owner_emailed_at` mandatory on approval. A refusal whose remedy does
    not exist is an outage, not a guard.

    The fallback is NOT SILENT: `no_owner_fallback: true` goes in the audit
    detail, the same shape `org_members._audit_grants` already uses.

    NO RECIPIENT AT ALL IS A REFUSAL. If the org has no owner and no address on
    file, there is nobody to tell, and a support session nobody was told about
    is the whole feature failing quietly. That is the one email failure this
    stack can actually detect — `email_service.send_email` returns True on
    thread handoff and is worthless as delivery evidence — so it is enforced
    here, before the grant.
    """
    owner = await conn.fetchrow(
        "SELECT u.email, u.name FROM public.user_roles ur "
        "JOIN users u ON u.user_id = ur.user_id "
        "WHERE ur.org_id = $1::uuid AND ur.role_code = 'org_owner' "
        "  AND u.email IS NOT NULL AND u.email <> '' "
        "ORDER BY ur.granted_at LIMIT 1",
        org_id,
    )
    if owner and owner["email"]:
        return owner["email"], (owner["name"] or owner["email"]), False

    org = await conn.fetchrow(
        "SELECT name, email FROM public.organisations WHERE id = $1::uuid", org_id
    )
    if org and (org["email"] or "").strip():
        return org["email"].strip(), (org["name"] or org["email"]), True

    raise SupportSessionError(
        409,
        "This organisation has no owner and no email address on file, so there "
        "is nobody to notify. A support session the customer was never told "
        "about must not open. Add an organisation email address first.",
    )


def _approval_email(*, org_name, ref, agent_name, reason, modules,
                    access_level, ttl_hours, expires_at):
    """(subject, html) for the mail the customer's owner receives.

    Built from `email_service`'s own components so it looks like every other
    message the product sends. `_base` escapes the kicker, headline and
    sanskrit; the reason and the agent name are escaped HERE because they land
    in `body_rows`, which stays the caller's responsibility by design.
    """
    from html import escape as _h

    from email_service import _base, _body_text, _info_card, _notice

    window = (
        "Until revoked" if ttl_hours == 0
        else f"{ttl_hours} hours"
        if ttl_hours < 24 else f"{ttl_hours // 24} day(s)"
    )
    card = _info_card([
        ("Reference", _h(ref)),
        ("Support agent", _h(agent_name)),
        ("Organisation", _h(org_name or "")),
        ("Modules", _h(", ".join(modules))),
        ("Access", _h(access_level.title())),
        ("Window", _h(window)),
        ("Ends", _h(expires_at.strftime("%d %b %Y, %H:%M UTC")) if expires_at
                 else "When you revoke it"),
    ])
    body = (
        _body_text(
            "Access to your organisation has been opened for an Aekam support "
            "agent. It was approved on your behalf and it is recorded in your "
            "organisation's audit log."
        )
        + card
        + _body_text("<strong>Their stated reason</strong><br>" + _h(reason))
        + _notice(
            "You can end this at any time from Organisation settings → Security. "
            "Revoking takes effect on the agent's very next request.",
            tone="warn",
        )
    )
    return (
        f"Support access opened for your organisation ({ref})",
        _base(
            preheader=f"An Aekam support agent now has {access_level} access ({ref}).",
            kicker="Support access",
            headline="Someone from Aekam can now see your data",
            sanskrit="सहायता प्रवेश",
            lede="This is the notice we promised you would always get.",
            body_rows=body,
        ),
    )


# ═════════════════════════════════════════════════════════════════════════════
# 0 · THE STEP IN FRONT — the organisation asks Aekam for help.
#
# THE OWNER'S FLOW, VERBATIM:
#
#     org requests > aekam gets email and notification > aekam sends request
#     > org approves
#
# Everything below section 0 is the last two steps of that sentence. Section 0
# is the first one, and until it existed there was no way for a customer to ask
# at all — the only entry point was an Aekam operator deciding to knock.
#
# ── THE DOUBLE APPROVAL IS DELIBERATE. DO NOT COLLAPSE IT. ──────────────────
#
# The obvious "simplification" is to have an approved help request open a
# session, or to let the ask carry the modules and the TTL so Aekam only has to
# press one button. Both are the feature inverted, and this note is here because
# a reader who does not know that will make one of them:
#
#   · The org asks. It says WHAT IS WRONG. It grants nothing, names no
#     duration, and confers no authority of any kind.
#   · Aekam replies with a PROPOSED SCOPE — which modules, viewer or editor,
#     for how long. That is `request_session`, section 1.
#   · The org approves THAT SCOPE. That is `open_session`, section 2, and it is
#     the only place in this product where support access is created.
#
# The two approvals are not redundant, because they are approvals of different
# things. The first is "yes, we want help"; the second is "yes, THAT MUCH, for
# THAT LONG". An organisation that asks for help with a stuck invoice run has
# not agreed to a week of editor access across six modules, and the whole reason
# this feature exists instead of the `X-Org-Id` header is that somebody has to
# be asked the second question.
#
# ── WHY A FAILED EMAIL DOES NOT ROLL THIS BACK, WHEN IT DOES IN `open_session` ─
#
# The polarity is opposite, and it is opposite for a reason that is easy to get
# backwards. In `open_session` the mail is the customer's ONLY warning that a
# stranger now has their records, so a mail that did not go out means a grant
# that must not stand: refusing is the safe direction.
#
# Here the customer is asking for help. Refusing the ask because a mail provider
# is down leaves an organisation that is already in trouble with nothing —
# no row, no record, no queue entry — which is the harmful direction. So:
#
#   · the `notifications` rows and the audit row are written INSIDE the
#     transaction, on the same connection, with no try/except. They are the
#     record, and `psr_somebody_at_aekam_was_told` makes an ask that told
#     nobody impossible at the database.
#   · the email is sent AFTER COMMIT, best-effort, through the product's normal
#     threaded `send_email`. It is a convenience on top of a record that already
#     exists, and `staging.outbound_log` says what happened to it.
#
# That also keeps `blocking=True` at exactly one caller, which is what its own
# docstring in `email_service` promises. A second blocking sender would put a
# provider round trip on a second request path.
# ═════════════════════════════════════════════════════════════════════════════

#: ASK-XXXXXX. The same alphabet as `SUP-`, deliberately a different prefix: the
#: two refs travel together in one conversation ("we raised ASK-A1B2C3", "we
#: replied with SUP-D4E5F6") and a shared prefix would make the audit log unable
#: to say which of the two a row is about. Mirrors 182's
#: CHECK (ref ~ '^ASK-[0-9A-HJ-NP-Z]{6}$').
def new_ask_ref() -> str:
    return "ASK-" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(6))


_REQUESTS_UNAPPLIED = (
    "Asking Aekam for help is not available on this deployment. "
    "migrations/182_org_initiated_support_requests.sql has not been applied."
)

_REQUESTS_TABLE_ABSENT_LOGGED = False


def _note_requests_absent() -> None:
    global _REQUESTS_TABLE_ABSENT_LOGGED
    if not _REQUESTS_TABLE_ABSENT_LOGGED:
        _REQUESTS_TABLE_ABSENT_LOGGED = True
        log.warning(
            "public.platform_support_requests is absent — migration 182 is "
            "unapplied, so no organisation has asked for help. Logged once."
        )


#: Where the ask lands at Aekam, in addition to a notification row per person.
#: An address rather than a role lookup so that a mailbox somebody actually
#: watches gets it even on a day when every god-mode account is on leave.
#: Overridable, because the address is a deployment fact and not a code one.
PLATFORM_SUPPORT_INBOX = os.environ.get(
    "PLATFORM_SUPPORT_EMAIL", "support@aekaminc.com"
)

#: The in-app notification kind. NOT in `push_service.DEFAULT_PREFS`, and it does
#: not need to be: these rows are written with `push=False`, so the preference
#: gate is never consulted. See `_notify_aekam` for why.
_ASK_NOTIFICATION_KIND = "support_request"

#: Where the notification points. `App.jsx:306` mounts `SupportSessionsPage`
#: at `/admin/support` under the `/admin` shell.
_ASK_CONSOLE_URL = "/admin/support"


def validate_help_request(*, reason: str, modules, requestable) -> None:
    """Refuse an ask that could not mean anything. Raises SupportSessionError.

    Deliberately SHORTER than `validate_request`: there is no access level and
    no duration to check, because an ask names neither. What is left is the
    reason and the module hint.

    THE MODULE LIST IS OPTIONAL HERE AND MANDATORY THERE, and that asymmetry is
    the point. An organisation whose invoice run is stuck often does not know
    which module is at fault, and refusing their ask over that would be the
    product asking the customer to diagnose it. A support SESSION with no
    modules, by contrast, reaches nothing and is a row nobody finished filling
    in — `request_session` refuses that one.

    `requestable` is passed in rather than imported, for the same reason
    `validate_request` takes it: this function stays pure, and the ONE list of
    modules lives next to the ONE list of paths a session may reach.
    """
    if not reason or len(reason.strip()) < MIN_REASON_LENGTH:
        raise SupportSessionError(
            400,
            f"Say what you need help with, in at least {MIN_REASON_LENGTH} "
            "characters. Aekam has to decide what access to ask you for, and "
            '"help" is not something anybody can scope.',
        )

    mods = list(modules or ())
    if len(set(mods)) != len(mods):
        raise SupportSessionError(400, "Each module may be named once.")

    unknown = [m for m in mods if m not in requestable]
    if unknown:
        # NOT a silent drop. An org that ticks "payroll" and gets an ask with no
        # modules on it has been told nothing about why, and would reasonably
        # expect help with payroll to be coming.
        raise SupportSessionError(
            400,
            "Aekam can never be given access to: "
            f"{', '.join(sorted(unknown))}. Payroll, personnel files and "
            "attendance photographs are outside every support session, so "
            "naming them here would promise something the product cannot do. "
            "Leave the modules blank and describe the problem instead — or "
            "phone, if that is what the problem is about.",
        )


async def _aekam_recipients(conn, aekam_roles) -> list[dict]:
    """The Aekam accounts that get a notification row for an ask.

    THE RECIPIENT SET IS GUESSED, which is why 182 records it on the row.
    `platform_support` has ZERO holders live (measured 2026-08-21), so the
    people who can actually answer an ask are whichever god-mode accounts exist
    on the day — and that changes without this code changing.

    `aekam_roles` is passed in rather than imported so this file keeps its
    existing discipline: the role vocabulary lives in `middleware/role_tiers.py`
    and the router hands it down. Two copies would drift, and the permissive
    direction of that drift is notifying people who cannot act.

    NO EMAIL ADDRESSES COME BACK. The notification row needs a user id and the
    display name is for the message text; the ONE mail goes to
    `PLATFORM_SUPPORT_INBOX`, not to a fan-out of individual addresses.
    """
    rows = await conn.fetch(
        "SELECT DISTINCT ON (u.user_id) u.user_id, "
        "       COALESCE(NULLIF(TRIM(u.full_name),''), NULLIF(TRIM(u.name),''), "
        "                'Name not on file') AS display_name "
        "  FROM public.user_roles ur "
        "  JOIN users u ON u.user_id = ur.user_id "
        " WHERE ur.org_id IS NULL AND ur.role_code = ANY($1::text[]) "
        " ORDER BY u.user_id",
        list(aekam_roles),
    )
    return [{"user_id": r["user_id"], "display_name": r["display_name"]}
            for r in rows]


async def _notify_aekam(conn, recipients, *, ref: str, org_name: str,
                        raised_by_name: str) -> None:
    """One `notifications` row per Aekam account, INSIDE the caller's transaction.

    THE PRODUCT'S OWN WRITER, not a second one. `server.create_notification` is
    what every other feature in this backend calls, so the row this produces is
    shaped exactly like the rows already in the Inbox and needs no special
    reader. The import is deferred because `server` imports the routers; every
    other cross-import of `server` in this codebase (`routers/search.py`,
    `routers/tasks_bulk.py`, `routers/activity.py`) is deferred for the same
    reason.

    `conn` IS PASSED WHERE IT EXPECTS A POOL, and that is the point rather than
    an accident: an `asyncpg.Connection` answers `.execute` identically, so the
    INSERT lands inside this transaction and rolls back with it. An ask that
    told nobody must not exist, and 182's `psr_somebody_at_aekam_was_told` is
    the same rule stated where Python cannot reorder it.

    `push=False`, deliberately. A push fired from inside an open transaction is
    a push about a row that may still roll back, and there is no way to un-send
    it. The ROW is the record — which is `create_notification`'s own rule, from
    the other direction: quiet hours suppress the device, never the record.
    """
    from server import create_notification

    for person in recipients:
        await create_notification(
            conn,
            person["user_id"],
            _ASK_NOTIFICATION_KIND,
            f"{org_name} has asked for support",
            f"{raised_by_name} raised {ref}. Nothing is granted yet — open it "
            "to propose a scope for them to approve.",
            url=_ASK_CONSOLE_URL,
            push=False,
        )


def _help_request_email(*, org_name, ref, raised_by_name, reason, modules):
    """(subject, html) for the mail Aekam's support inbox receives.

    Built from `email_service`'s own components, like `_approval_email`.

    WHO ESCAPES WHAT, because the two components differ and getting it backwards
    is either a hole or a mess:

      · `_info_card` escapes BOTH the label and the value itself — its docstring
        says so. Values go in RAW. (`_approval_email` above passes `_h(...)` into
        it and therefore double-escapes: a customer called "Sharma & Co" reads
        as "Sharma &amp; Co" in the approval mail. Cosmetic, pre-existing, and
        deliberately not changed here — but do not copy it.)
      · `_body_text` does NOT escape, because its whole purpose is to take
        markup — so the reason is escaped HERE before it is concatenated with
        the `<strong>` around it.
      · `_base` escapes the preheader, kicker, headline and sanskrit itself.

    NO EMAIL ADDRESS AND NO USER ID appears in this message. Aekam is told WHICH
    ORGANISATION and WHO by name; reaching the person goes through the approved
    session, which leaves an audit row.
    """
    from html import escape as _h

    from email_service import _base, _body_text, _info_card, _notice

    # RAW — `_info_card` escapes every value it is given.
    card = _info_card([
        ("Reference", ref),
        ("Organisation", org_name or ""),
        ("Raised by", raised_by_name),
        ("Modules named", ", ".join(modules) if modules
                          else "None — they did not say"),
    ])
    body = (
        _body_text(
            "An organisation has asked for support. THIS GRANTS NOTHING: it is "
            "a request for help, not access. To act on it, propose a scope from "
            "the support console — the customer then approves that scope, and "
            "only their approval opens a session."
        )
        + card
        + _body_text("<strong>What they said</strong><br>" + _h(reason))
        + _notice(
            "Nobody at Aekam can see this organisation's records because of "
            "this message. Access begins only when they approve a scope you "
            "asked for.",
            tone="warn",
        )
    )
    return (
        f"Support requested by {org_name or 'a customer'} ({ref})",
        _base(
            preheader=f"{org_name or 'A customer'} has asked Aekam for help ({ref}).",
            kicker="Support requested",
            headline="A customer has asked for help",
            sanskrit="सहायता निवेदन",
            lede="They asked. Nothing is granted until they approve a scope.",
            body_rows=body,
        ),
    )


async def raise_help_request(
    pool, *, org_id: str, raised_by: str, reason: str, modules, requestable,
    aekam_roles,
) -> dict:
    """An organisation asks Aekam for help. GRANTS NOTHING. It is a signal.

    `raised_by` is the caller's own id, taken from the session token by the
    router and NEVER read from the request body — the same rule
    `request_session` follows, for the mirrored reason: an endpoint that let you
    name the asker is an endpoint that lets you raise a help request in somebody
    else's name and have Aekam knock on their door.

    ORDER, AND WHY IT IS THIS ORDER:

      1. validate                     a reason nobody can scope is refused first
      2. the org exists and is active
      3. resolve the Aekam recipients — REFUSE if there are none
      4. INSERT the ask, with those recipients on the row
      5. INSERT one notifications row each, unwrapped, same transaction
      6. INSERT the audit row, unwrapped, same transaction
      7. COMMIT
      8. mail the support inbox, best-effort, AFTER the commit

    Step 3 refuses rather than committing, mirroring `resolve_owner_recipient`:
    a cry for help filed where nobody will ever see it is worse than a refusal
    that says "phone us". Step 8 is outside the transaction because a mail
    provider outage must not throw the customer's ask away — see the section
    header for why that polarity is the opposite of `open_session`'s and why
    both are right.

    TWO PRESSES MAKE ONE ASK. That is
    `idx_psr_one_ask_per_person_per_org_per_day`, a unique index, and not a
    Python check — two presses race, and Aekam getting two mails and two
    notification rows about one problem is the failure.
    """
    validate_help_request(reason=reason, modules=modules, requestable=requestable)

    mods = list(modules or ())
    ref = None
    org_name = ""
    raised_by_name = "Name not on file"
    notified = 0

    async with pool.acquire() as conn:
        async with conn.transaction():
            org = await conn.fetchrow(
                "SELECT id, name FROM public.organisations "
                "WHERE id = $1::uuid AND is_active = TRUE",
                org_id,
            )
            if not org:
                raise SupportSessionError(404, "Organisation not found or inactive")
            org_name = org["name"] or ""

            recipients = await _aekam_recipients(conn, aekam_roles)
            if not recipients:
                raise SupportSessionError(
                    409,
                    "There is nobody at Aekam to send this to right now, so the "
                    "request was not raised — a request nobody receives is "
                    "worse than none. Please email support directly.",
                )

            asker = await conn.fetchrow(
                "SELECT COALESCE(NULLIF(TRIM(full_name),''), NULLIF(TRIM(name),''), "
                "                'Name not on file') AS display_name "
                "  FROM users WHERE user_id = $1",
                raised_by,
            )
            if asker:
                raised_by_name = asker["display_name"]

            ids = [p["user_id"] for p in recipients]

            # Retried on a ref collision only. 34^6 is 1.5 billion, so this is a
            # formality — but a UNIQUE violation on `ref` reaching the caller as
            # a 500 would be an outage caused by a coin flip. The nested
            # `conn.transaction()` is a SAVEPOINT: without it the first
            # violation aborts the whole transaction and the retry cannot run.
            row = None
            for _ in range(5):
                candidate = new_ask_ref()
                try:
                    async with conn.transaction():
                        row = await conn.fetchrow(
                            "INSERT INTO public.platform_support_requests "
                            "  (ref, org_id, raised_by, reason, modules, notified_to) "
                            "VALUES ($1, $2::uuid, $3, $4, $5::text[], $6::text[]) "
                            "RETURNING id, ref, raised_at",
                            candidate, org_id, raised_by, reason.strip(), mods, ids,
                        )
                except _STORE_ABSENT:
                    _note_requests_absent()
                    raise SupportSessionError(503, _REQUESTS_UNAPPLIED)
                except asyncpg.UniqueViolationError as exc:
                    if "idx_psr_one_ask_per_person_per_org_per_day" in str(exc):
                        raise SupportSessionError(
                            409,
                            "You have already asked for help with this "
                            "organisation today, and Aekam has it. Reply to "
                            "that email if there is more to add — a second "
                            "request would arrive as a separate problem.",
                        )
                    continue
                break
            if row is None:
                raise SupportSessionError(500, "Could not allocate a request reference")

            ref = row["ref"]

            # ── NOT BEST-EFFORT ─────────────────────────────────────────────
            # No try/except on either of the next two. If writing the
            # notification rows or the audit row fails, the ask rolls back and
            # the customer is told it did not go through — which is true, and is
            # far better than a row sitting in a table nobody was pointed at.
            await _notify_aekam(
                conn, recipients, ref=ref, org_name=org_name,
                raised_by_name=raised_by_name,
            )
            notified = len(recipients)

            # Into the CUSTOMER'S audit log, the one they can read — the same
            # choice `open_session` makes. `severity='info'`: this row records a
            # request, and nothing was authorised. The three rows that record an
            # authorisation CHANGING stay at 'warn', so a reader filtering for
            # them still sees only those.
            await _audit(
                conn,
                org_id=org_id,
                user_id=raised_by,
                action="platform.support_help_requested",
                ref=ref,
                resource_type=_RESOURCE_REQUEST,
                severity="info",
                detail={
                    "raised_by": raised_by,
                    "raised_by_name": raised_by_name,
                    "modules_named": mods,
                    "reason": reason.strip(),
                    "aekam_notified_count": notified,
                    # Said out loud in the trail, because "a support request was
                    # raised" is a sentence a reader can easily read as access.
                    "grants": "nothing",
                },
            )

    # ── AFTER THE COMMIT, AND BEST-EFFORT ───────────────────────────────────
    # The record already exists and Aekam already has a notification row. This
    # is the convenience on top. A provider failure must not throw away an
    # organisation's request for help, so unlike `open_session` this send is
    # neither blocking nor inside the transaction, and its outcome lives in
    # `staging.outbound_log` like every other send in the product.
    #
    # `org_scope` for the same reason `open_session` uses it: these routes do
    # not go through `get_org_id`, so nothing has set the ContextVar
    # `outbound.begin()` reads, and a NULL `org_id` is a row
    # `routers/billing.py` will never return to the customer whose ask it is.
    try:
        from email_service import send_email
        from outbound import org_scope

        subject, html = _help_request_email(
            org_name=org_name, ref=ref, raised_by_name=raised_by_name,
            reason=reason.strip(), modules=mods,
        )
        with org_scope(org_id, raised_by):
            send_email(
                PLATFORM_SUPPORT_INBOX, subject, html,
                purpose="support_request",
                ref=f"support_request:{ref}",
            )
    except Exception:                                        # pragma: no cover
        # THE ONLY `except Exception` IN THIS MODULE, and it is deliberately
        # AFTER the commit. It cannot hide a lost record: the row, the
        # notification rows and the audit entry are already durable. Wrapping
        # anything ABOVE the commit in one of these is the defect this whole
        # file is written to prevent — see the module header.
        log.warning("support help request %s: the inbox mail did not go out", ref,
                    exc_info=True)

    return {
        "ref": ref,
        "org_id": org_id,
        "org_name": org_name,
        "modules_named": mods,
        "aekam_notified": notified,
        # Said out loud in the response, because the customer's next question is
        # "does somebody from Aekam have my books now".
        "grants": "nothing — Aekam must still ask you for access, and you decide",
    }


# ═════════════════════════════════════════════════════════════════════════════
# 1 · request  —  (none) → requested.  GRANTS NOTHING.
# ═════════════════════════════════════════════════════════════════════════════

async def request_session(
    pool, *, requested_by: str, org_id: str, reason: str, modules,
    access_level: str, ttl_hours: int, requestable,
) -> dict:
    """Ask a customer for access. The agent holds ZERO access until approval.

    `requested_by` is the caller's own id, taken from the session token by the
    router and NEVER read from the request body — a request endpoint that let
    you name the requester is an endpoint that lets you get a colleague
    approved and then use their session.

    Two presses make ONE request. That is
    `idx_pss_one_pending_per_agent_per_org`, a partial unique index on the
    UNDECIDED state, and not a Python check — two presses race, and the customer
    getting two mails about one request is the failure. The index is partial so
    a DENIED request may be asked again with a better reason, which is the
    intended narrowing path.
    """
    validate_request(
        reason=reason, modules=modules, access_level=access_level,
        ttl_hours=ttl_hours, requestable=requestable,
    )

    org = await pool.fetchrow(
        "SELECT id, name FROM public.organisations "
        "WHERE id = $1::uuid AND is_active = TRUE",
        org_id,
    )
    if not org:
        raise SupportSessionError(404, "Organisation not found or inactive")

    # Retried on a ref collision only. 34^6 is 1.5 billion, so this is a
    # formality — but a UNIQUE violation on `ref` reaching the caller as a 500
    # would be an outage caused by a coin flip.
    for _ in range(5):
        ref = new_ref()
        try:
            row = await pool.fetchrow(
                "INSERT INTO public.platform_support_sessions "
                "  (ref, org_id, requested_by, reason, modules, access_level, "
                "   requested_ttl_hours) "
                "VALUES ($1, $2::uuid, $3, $4, $5::text[], $6, $7) "
                "RETURNING id, ref, requested_at",
                ref, org_id, requested_by, reason.strip(), list(modules),
                access_level, ttl_hours,
            )
        except _STORE_ABSENT:
            _note_absent()
            raise SupportSessionError(503, _UNAPPLIED)
        except asyncpg.UniqueViolationError as exc:
            if "idx_pss_one_pending_per_agent_per_org" in str(exc):
                raise SupportSessionError(
                    409,
                    "You already have a request pending with this organisation. "
                    "Wait for their decision, or withdraw it first.",
                )
            continue
        return {
            "id": str(row["id"]),
            "ref": row["ref"],
            "org_id": org_id,
            "org_name": org["name"],
            "requested_at": row["requested_at"].isoformat(),
            "modules": list(modules),
            "access_level": access_level,
            "requested_ttl_hours": ttl_hours,
            # Said out loud in the response, because the operator's next
            # question is "am I in yet".
            "grants": "nothing until the customer approves it",
        }

    raise SupportSessionError(500, "Could not allocate a session reference")


# ═════════════════════════════════════════════════════════════════════════════
# 2 · approve  —  requested → active.  THE ONLY PLACE ACCESS IS CREATED.
# ═════════════════════════════════════════════════════════════════════════════

async def open_session(
    pool, *, session_id: str, org_id: str, approver_id: str,
    granted_ttl_hours: int | None = None,
) -> dict:
    """The customer says yes. Approval IS the start — there is no dormant grant.

    There is no `started_at` column and no approved-but-not-yet-started state,
    and that is the answer rather than an omission: a grant that is approved but
    dormant is a grant with no clock, which is exactly what 111's
    `pss_expiry_matches_granted_ttl` refuses. `expires_at` is computed as
    NOW() + granted_ttl_hours IN THE SAME STATEMENT that writes `approved_at`,
    by Postgres. The clock runs from the customer's consent, not from the
    operator's convenience.

    ORDER, AND WHY IT IS THIS ORDER:

      1. SELECT ... FOR UPDATE       two approvers pressing at once
      2. refuse self-approval, refuse an already-decided row
      3. resolve the recipient       a refusal if there is nobody to tell
      4. UPDATE ... WHERE still undecided   409 if the race was lost
      5. SEND THE MAIL, AND WAIT FOR THE PROVIDER   unwrapped; rolls 4 back
      6. INSERT the audit row        unwrapped; a raise rolls 4 and 5's row back
      7. COMMIT

    The mail is sent AFTER the UPDATE so that a lost race does not mail the
    customer about a session that did not open, and BEFORE the commit so that a
    failure to send un-does the grant. Email is not transactional and cannot be;
    the residue of a rollback here is one message about access that was not
    granted, which is the safe direction to be wrong in.

    ── WHAT "A FAILURE TO SEND UN-DOES THE GRANT" IS WORTH ─────────────────────

    It used to be worth nothing, and this docstring said it anyway. The default
    `email_service.send_email` hands the message to a `threading.Thread` and
    returns True before that thread runs a line — its own docstring says the
    return value "is worth nothing as evidence of a send". Measured: with the
    Resend client raising `422 recipient domain does not exist`, `send_email`
    returned True, the transaction committed, the row asserted
    `owner_emailed_at = NOW()`, the API answered `owner_notified:
    owner@customer.test`, and nobody was told. `pss_approval_and_owner_email_are_
    one_act` was satisfied by a value the code could not substantiate.

    So the send is now `blocking=True`: the provider call runs on this thread and
    its real answer is what decides. `owner_emailed_at = NOW()` in step 4 is now
    a claim this function can stand behind — a refusal raises before COMMIT and
    the whole statement is rolled back.

    ONE HONEST GAP, and it is deliberate: with `OUTBOUND_MODE=dry` the kill
    switch suppresses the message and reports success, because the deployment
    asked for nothing to leave the building. The `suppressed` row in
    `staging.outbound_log` carries `mode='dry'` and says so.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                row = await conn.fetchrow(
                    "SELECT id, ref, org_id, requested_by, reason, modules, "
                    "       access_level, requested_ttl_hours, "
                    "       approved_at, denied_at "
                    "  FROM public.platform_support_sessions "
                    " WHERE id = $1::uuid AND org_id = $2::uuid "
                    "   FOR UPDATE",
                    session_id, org_id,
                )
            except _STORE_ABSENT:
                _note_absent()
                raise SupportSessionError(503, _UNAPPLIED)

            if not row:
                raise SupportSessionError(404, "No such support request")

            # ── IMPOSSIBILITY 5 · SELF-APPROVAL ─────────────────────────────
            # The requester cannot be the approver. Deleting these three lines
            # turns the feature into "an Aekam account may grant itself access
            # to any organisation", which is the leak this whole file exists to
            # keep closed. Self-DENIAL is permitted a few functions down —
            # denying yourself removes access, approving yourself creates it,
            # and only one of those is an escalation.
            if row["requested_by"] == approver_id:
                raise SupportSessionError(
                    403,
                    "You cannot approve your own support request. The point of "
                    "the approval is that somebody else made it.",
                )

            if row["approved_at"] is not None:
                raise SupportSessionError(409, "This request is already approved")
            if row["denied_at"] is not None:
                raise SupportSessionError(409, "This request was already declined")

            ttl = (
                row["requested_ttl_hours"]
                if granted_ttl_hours is None else granted_ttl_hours
            )
            if ttl not in TTL_CHOICES:
                raise SupportSessionError(
                    400,
                    "duration must be one of: "
                    f"{', '.join(str(t) for t in TTL_CHOICES)} "
                    "(0 means until revoked).",
                )
            # The customer may shorten what was asked for; they may not lengthen
            # it. Both numbers are kept on the row, so an approval that narrowed
            # a request stays visible afterwards.
            if row["requested_ttl_hours"] != 0 and (ttl == 0 or ttl > row["requested_ttl_hours"]):
                raise SupportSessionError(
                    400,
                    "An approval can shorten what was requested, never lengthen "
                    f"it. This request asked for {row['requested_ttl_hours']} hours.",
                )

            to_email, to_name, no_owner_fallback = await resolve_owner_recipient(
                conn, org_id
            )

            # `expires_at` computed BY POSTGRES in the same statement as
            # `approved_at`. Never from a Python clock: a worker that has been up
            # for six hours must not get a vote in when a two-hour session ends.
            updated = await conn.fetchrow(
                "UPDATE public.platform_support_sessions "
                "   SET approved_by = $2, "
                "       approved_at = NOW(), "
                "       owner_emailed_at = NOW(), "
                "       granted_ttl_hours = $3, "
                "       expires_at = CASE WHEN $3 > 0 "
                "                    THEN NOW() + make_interval(hours => $3) "
                "                    ELSE NULL END "
                " WHERE id = $1::uuid "
                "   AND approved_at IS NULL "
                "   AND denied_at IS NULL "
                "RETURNING ref, approved_at, expires_at",
                session_id, approver_id, ttl,
            )
            if not updated:
                # Somebody else decided it between the FOR UPDATE and here,
                # which the row lock makes near-impossible and which
                # `pss_not_both_approved_and_denied` would catch anyway. No
                # second mail, no second audit row.
                raise SupportSessionError(409, "This request was decided by someone else")

            agent = await conn.fetchrow(
                "SELECT name, email FROM users WHERE user_id = $1",
                row["requested_by"],
            )
            org = await conn.fetchrow(
                "SELECT name FROM public.organisations WHERE id = $1::uuid", org_id
            )

            # ── NOT BEST-EFFORT ─────────────────────────────────────────────
            # No try/except. If composing or handing off the message raises, the
            # transaction rolls back and the session does not open —
            # `pss_approval_and_owner_email_are_one_act` says the approval and
            # the mail are one act, and this is that constraint enforced on the
            # side the database cannot see.
            from email_service import send_email

            subject, html = _approval_email(
                org_name=org["name"] if org else "",
                ref=updated["ref"],
                agent_name=(agent["name"] or agent["email"]) if agent
                           else row["requested_by"],
                reason=row["reason"],
                modules=list(row["modules"] or ()),
                access_level=row["access_level"],
                ttl_hours=ttl,
                expires_at=updated["expires_at"],
            )
            # ── WHOSE SEND IS THIS ──────────────────────────────────────────
            #
            # `outbound.begin()` defaults `org_id` from a ContextVar that ONLY
            # `org_resolver._attribute` ever sets — and the routes in
            # `routers/support_sessions.py` deliberately do not use `get_org_id`,
            # because the requester is not a member of the customer's org. So
            # without this block the row went in with `org_id = NULL`, and
            # `routers/billing.py` reads that table `WHERE org_id = $1::uuid`
            # with the standing comment "a NULL org_id is a send belonging to no
            # tenant and must never be attributed to one". The one artefact that
            # would tell anybody the owner was NOT notified would have been
            # written where the customer can never see it.
            #
            # `org_scope` and not `set_org`: this is a request path that cannot
            # rely on a task boundary to throw the value away, and it puts back
            # whatever it found.
            from outbound import org_scope

            with org_scope(org_id, approver_id):
                # `blocking=True` IS THE WHOLE GUARANTEE. The default hands the
                # message to a `threading.Thread` and returns True before that
                # thread runs a line, so "a failure to send un-does the grant"
                # was false for every real delivery failure — measured, a Resend
                # 422 produced `send_email -> True` and a `failed` row against a
                # transaction that had already committed. This waits for the
                # provider and returns what it actually said.
                sent = send_email(
                    to_email, subject, html,
                    purpose="support_session",
                    ref=f"support_session:{updated['ref']}",
                    blocking=True,
                )
            if not sent:
                raise SupportSessionError(
                    502,
                    "The owner notification was refused by the mail provider, so "
                    "the session was not opened. Support access is never silent.",
                )

            # ── ALSO NOT BEST-EFFORT ────────────────────────────────────────
            # Into the CUSTOMER'S audit log, the one they can read.
            await _audit(
                conn,
                org_id=org_id,
                user_id=approver_id,
                action="platform.support_session_opened",
                ref=updated["ref"],
                detail={
                    "requested_by": row["requested_by"],
                    "approved_by": approver_id,
                    "modules": list(row["modules"] or ()),
                    "access_level": row["access_level"],
                    "requested_ttl_hours": row["requested_ttl_hours"],
                    "granted_ttl_hours": ttl,
                    "expires_at": (updated["expires_at"].isoformat()
                                   if updated["expires_at"] else None),
                    "reason": row["reason"],
                    "owner_emailed_to": to_email,
                    "owner_emailed_name": to_name,
                    # The same key `org_members._audit_grants` uses. The
                    # fallback recipient is a fact about the row, not a secret.
                    "no_owner_fallback": no_owner_fallback,
                },
            )

            return {
                "id": session_id,
                "ref": updated["ref"],
                "approved_at": updated["approved_at"].isoformat(),
                "expires_at": (updated["expires_at"].isoformat()
                               if updated["expires_at"] else None),
                "granted_ttl_hours": ttl,
                "owner_notified": to_email,
                "no_owner_fallback": no_owner_fallback,
            }


# ═════════════════════════════════════════════════════════════════════════════
# 3 · deny  —  requested → denied.  TERMINAL, and re-askable.
# ═════════════════════════════════════════════════════════════════════════════

async def deny_session(
    pool, *, session_id: str, org_id: str, decided_by: str, reason: str,
    is_requester: bool = False,
) -> dict:
    """The customer says no, or the agent withdraws.

    Self-denial is deliberately permitted while self-approval is not. A
    withdrawal is the requester removing their own pending ask, which takes
    nothing away from anybody.

    Terminal — but `idx_pss_one_pending_per_agent_per_org` covers only the
    UNDECIDED state, so a denied request may be raised again with a better
    reason. That is the intended narrowing path and the reason there is no
    "extend".
    """
    if not reason or not reason.strip():
        raise SupportSessionError(
            400, "Say why. A decision with no reason is not a decision anybody can act on."
        )

    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                row = await conn.fetchrow(
                    "SELECT id, ref, requested_by, approved_at, denied_at "
                    "  FROM public.platform_support_sessions "
                    " WHERE id = $1::uuid AND org_id = $2::uuid FOR UPDATE",
                    session_id, org_id,
                )
            except _STORE_ABSENT:
                _note_absent()
                raise SupportSessionError(503, _UNAPPLIED)

            if not row:
                raise SupportSessionError(404, "No such support request")
            if row["approved_at"] is not None:
                raise SupportSessionError(
                    409,
                    "This session is already approved. Revoke it instead — that "
                    "takes effect on the agent's very next request.",
                )
            if row["denied_at"] is not None:
                raise SupportSessionError(409, "This request was already declined")

            await conn.execute(
                "UPDATE public.platform_support_sessions "
                "   SET denied_by = $2, denied_at = NOW(), denial_reason = $3 "
                " WHERE id = $1::uuid AND approved_at IS NULL AND denied_at IS NULL",
                session_id, decided_by, reason.strip(),
            )
            await _audit(
                conn,
                org_id=org_id,
                user_id=decided_by,
                action="platform.support_session_denied",
                ref=row["ref"],
                detail={
                    "requested_by": row["requested_by"],
                    "denied_by": decided_by,
                    "reason": reason.strip(),
                    "withdrawal": bool(is_requester),
                },
                severity="info",
            )
            return {"id": session_id, "ref": row["ref"], "denied": True}


# ═════════════════════════════════════════════════════════════════════════════
# 4 · revoke  —  active → revoked.  IMMEDIATE, and there is no sweeper.
# ═════════════════════════════════════════════════════════════════════════════

async def revoke_session(
    pool, *, session_id: str, org_id: str, revoked_by: str, party: str,
) -> dict:
    """End a live session. The row leaves the view on the very next read.

    THREE PARTIES, which is why `revoked_by_party` exists separately from
    `revoked_by` — an Aekam platform admin can also be the person who requested
    it, so the identity does not say which of the three happened:

      customer  an org_owner or org_admin of that org, at any time, no reason
      aekam     a god-mode platform admin ending a colleague's session
      self      the requester closing their own

    No sweeper and nothing to schedule: `staging.v_active_support_sessions`
    carries `revoked_at IS NULL`, so the grant is gone the instant this commits.
    """
    if party not in ("customer", "aekam", "self"):
        raise SupportSessionError(400, "revoked_by_party must be customer, aekam or self")

    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                row = await conn.fetchrow(
                    "SELECT id, ref, requested_by, approved_at, revoked_at "
                    "  FROM public.platform_support_sessions "
                    " WHERE id = $1::uuid AND org_id = $2::uuid FOR UPDATE",
                    session_id, org_id,
                )
            except _STORE_ABSENT:
                _note_absent()
                raise SupportSessionError(503, _UNAPPLIED)

            if not row:
                raise SupportSessionError(404, "No such support session")
            if row["approved_at"] is None:
                # 111's `pss_revocation_needs_an_approval`: revoking something
                # never approved has no meaning. The withdrawal of a request is
                # a denial, and it has its own columns.
                raise SupportSessionError(
                    409, "This request was never approved. Decline it instead."
                )
            if row["revoked_at"] is not None:
                raise SupportSessionError(409, "This session is already revoked")

            await conn.execute(
                "UPDATE public.platform_support_sessions "
                "   SET revoked_by = $2, revoked_at = NOW(), revoked_by_party = $3 "
                " WHERE id = $1::uuid AND revoked_at IS NULL",
                session_id, revoked_by, party,
            )
            await _audit(
                conn,
                org_id=org_id,
                user_id=revoked_by,
                action="platform.support_session_revoked",
                ref=row["ref"],
                detail={
                    "requested_by": row["requested_by"],
                    "revoked_by": revoked_by,
                    "revoked_by_party": party,
                },
            )
            return {"id": session_id, "ref": row["ref"], "revoked": True}


# ═════════════════════════════════════════════════════════════════════════════
# 5 · Reads. All of them answer "no sessions" when the table is absent.
# ═════════════════════════════════════════════════════════════════════════════

#: Read once, rendered twice. `state` is DERIVED here from the same timestamp
#: shapes `v_active_support_sessions` uses, and it is never stored — see the
#: module header and 111's argument against a `status` column.
_LIST_COLUMNS = """
    s.id, s.ref, s.org_id, s.requested_by, s.reason, s.modules, s.access_level,
    s.requested_ttl_hours, s.requested_at,
    s.approved_by, s.approved_at, s.granted_ttl_hours, s.expires_at,
    s.denied_by, s.denied_at, s.denial_reason,
    s.revoked_by, s.revoked_at, s.revoked_by_party
"""

#: The two people on the row, by NAME. `SUP-A1B2C3` is what gets read down a
#: phone line, but `user_549c9cac35aa` is not something a customer can act on —
#: the org owner deciding whether to let somebody in needs to be told WHO.
#: LEFT JOIN, because a deleted user must not remove the row from the list.
_LIST_FROM = """
      FROM public.platform_support_sessions s
      JOIN public.organisations o ON o.id = s.org_id
 LEFT JOIN users ru ON ru.user_id = s.requested_by
 LEFT JOIN users au ON au.user_id = s.approved_by
"""

#: THE THREE-LEG COALESCE, and both of the legs it dropped were leaks.
#:
#: This was `COALESCE(ru.name, ru.email, s.requested_by)`, and it failed the two
#: standing rules at once:
#:
#:   · `ru.email` — this list is served to the CUSTOMER (`list_for_org`) and to
#:     Aekam (`list_all`), so that leg handed each side the other's address on a
#:     screen neither had to ask for. `admin_orgs.py:829` already dropped exactly
#:     this leg from the org list for exactly this reason: "Aekam must not see
#:     client personal data". The address is not gone, it is gated — an approved
#:     session is where a support account reaches a customer's records.
#:   · `s.requested_by` — `user_549c9cac35aa` on a screen. `names, not IDs`, and
#:     `frontend/scripts/check-rendered-ids.mjs` is the ratchet.
#:
#: `full_name` was missing entirely, which is what made `name` look load-bearing.
#: The final leg is a SENTENCE, so a row with nobody on file says so rather than
#: showing a token that looks like data.
_LIST_NAMES = """
    o.name AS org_name,
    COALESCE(NULLIF(TRIM(ru.full_name),''), NULLIF(TRIM(ru.name),''),
             'Name not on file') AS requested_by_name,
    CASE WHEN s.approved_by IS NULL THEN NULL ELSE
         COALESCE(NULLIF(TRIM(au.full_name),''), NULLIF(TRIM(au.name),''),
                  'Name not on file') END AS approved_by_name
"""


def derive_state(row) -> str:
    """The five states, as names for shapes of timestamps. Never stored."""
    if row["denied_at"] is not None:
        return "denied"
    if row["approved_at"] is None:
        return "requested"
    if row["revoked_at"] is not None:
        return "revoked"
    exp = row["expires_at"]
    if exp is not None:
        from datetime import datetime, timezone
        if exp <= datetime.now(timezone.utc):
            return "expired"
    return "active"


def _shape(row, *, viewer_may_decide: bool = False, viewer_id: str | None = None) -> dict:
    state = derive_state(row)
    return {
        "id": str(row["id"]),
        "ref": row["ref"],
        "org_id": str(row["org_id"]),
        "org_name": row["org_name"],
        "state": state,
        # THE APPROVE BUTTON IS NOT THE AUTHORITY. `open_session` refuses a
        # self-approval under the row lock whatever this says; this is only so
        # the screen does not offer a control that would be refused.
        "can_approve": bool(
            viewer_may_decide
            and state == "requested"
            and row["requested_by"] != viewer_id
        ),
        "requested_by": row["requested_by"],
        "requested_by_name": row["requested_by_name"],
        "approved_by_name": row["approved_by_name"],
        "reason": row["reason"],
        "modules": list(row["modules"] or ()),
        "access_level": row["access_level"],
        "requested_ttl_hours": row["requested_ttl_hours"],
        "granted_ttl_hours": row["granted_ttl_hours"],
        "requested_at": row["requested_at"].isoformat() if row["requested_at"] else None,
        "approved_by": row["approved_by"],
        "approved_at": row["approved_at"].isoformat() if row["approved_at"] else None,
        # NULL is UNTIL REVOKED, which is LIVE. A client that renders a missing
        # expiry as "expired" inverts the most permissive session there is.
        "expires_at": row["expires_at"].isoformat() if row["expires_at"] else None,
        "denied_at": row["denied_at"].isoformat() if row["denied_at"] else None,
        "denial_reason": row["denial_reason"],
        "revoked_at": row["revoked_at"].isoformat() if row["revoked_at"] else None,
        "revoked_by_party": row["revoked_by_party"],
    }


async def get_session(pool, session_id: str):
    """One row by id, or None. Used by the router to learn WHICH ORG to authorise
    against — the requester is not a member of it and cannot resolve it from a
    header, so the org has to come off the row.

    Returns None when the table is absent, which the router turns into a 404.
    """
    try:
        return await pool.fetchrow(
            "SELECT s.id, s.ref, s.org_id, s.requested_by "
            "  FROM public.platform_support_sessions s WHERE s.id = $1::uuid",
            session_id,
        )
    except _STORE_ABSENT:
        _note_absent()
        return None


async def _listed(pool, where: str, *args, viewer_may_decide=False, viewer_id=None):
    """The one list query, with the audience's WHERE clause supplied.

    EMPTY LIST WHEN THE TABLE HAS NOT BEEN CREATED. "No sessions" is the true
    and permanent answer for every org today, and a 500 on an org settings page
    because a migration has not run is not acceptable.
    """
    try:
        rows = await pool.fetch(
            f"SELECT {_LIST_COLUMNS}, {_LIST_NAMES} {_LIST_FROM} "
            f" WHERE {where} "
            " ORDER BY s.requested_at DESC LIMIT 200",
            *args,
        )
    except _STORE_ABSENT:
        _note_absent()
        return []
    return [
        _shape(r, viewer_may_decide=viewer_may_decide, viewer_id=viewer_id)
        for r in rows
    ]


async def list_for_org(pool, org_id: str, viewer_id: str | None = None) -> list[dict]:
    """What is pending and what is live for THIS organisation. The customer's view.

    `viewer_may_decide=True`: this list is only ever served to an org_owner or
    org_admin of the org, so `can_approve` turns on the ONE remaining question —
    whether the viewer is the requester.
    """
    return await _listed(
        pool, "s.org_id = $1::uuid", org_id,
        viewer_may_decide=True, viewer_id=viewer_id,
    )


async def list_for_agent(pool, user_id: str) -> list[dict]:
    """Every session this Aekam account has asked for. The operator's view.

    `can_approve` is False on every row here and that is the point: the operator
    is by definition the requester, and the requester never approves.
    """
    return await _listed(pool, "s.requested_by = $1", user_id, viewer_id=user_id)


async def list_all(pool, viewer_id: str | None = None) -> list[dict]:
    """Every session on the platform. GOD MODE ONLY — the router is the gate.

    `can_approve` is False on every row: an Aekam account approving an Aekam
    account is the feature inverted, whatever role it holds.
    """
    return await _listed(pool, "TRUE", viewer_id=viewer_id)


async def requestable_organisations(pool) -> list[dict]:
    """The organisations an operator may ASK. Id and name only.

    Deliberately a separate, minimal read rather than `/v1/admin/orgs`:
    `platform_support` holds no console role, so the admin list refuses it, and
    the one role this feature exists for would then have no way to name the
    customer it needs to reach. No plan, no spend, no counts, no contact
    details — the picker needs a name and nothing else, and everything extra
    would be customer data handed to an account with no session yet.
    """
    rows = await pool.fetch(
        "SELECT id, name FROM public.organisations "
        "WHERE is_active = TRUE ORDER BY name"
    )
    return [{"id": str(r["id"]), "name": r["name"]} for r in rows]


# ═════════════════════════════════════════════════════════════════════════════
# 6 · Reading the asks. Same rule as section 5: `[]` when the table is absent.
# ═════════════════════════════════════════════════════════════════════════════

#: HAS ANYBODY REPLIED TO THIS ASK YET, derived at read time and never stored.
#:
#: 182 refuses a `closed_at`/`answered_at` column for the reason 111 refuses a
#: `status` column: a stored answer is a cache of an event and its failure mode
#: is staleness. An ask is OPEN until Aekam raises a support session for that
#: organisation AFTER it was raised, and that is this EXISTS clause, evaluated
#: on every read. It cannot be late, cannot fail, and cannot be dropped in a
#: refactor without this string disappearing with it.
#:
#: `>=` and not `>`: an operator who raises the session seconds after reading
#: the ask must not leave it sitting in the queue because two timestamps landed
#: in the same instant.
_ASK_ANSWERED = """
    EXISTS (SELECT 1 FROM public.platform_support_sessions s
             WHERE s.org_id = r.org_id
               AND s.requested_at >= r.raised_at)
"""

_ASK_COLUMNS = f"""
    r.id, r.ref, r.org_id, r.raised_by, r.reason, r.modules, r.raised_at,
    /* A COUNT, never the array. `notified_to` holds Aekam user ids; the rule
       is names, not IDs, and there is no name worth rendering here — what the
       reader needs to know is that somebody was told.
       BLOCK COMMENT AND NOT `--`, deliberately: this string is concatenated
       into a larger statement, and one caller that collapses whitespace before
       sending would make a line comment swallow the rest of the query. */
    cardinality(r.notified_to) AS aekam_notified,
    o.name AS org_name,
    COALESCE(NULLIF(TRIM(u.full_name),''), NULLIF(TRIM(u.name),''),
             'Name not on file') AS raised_by_name,
    {_ASK_ANSWERED} AS answered
"""

_ASK_FROM = """
      FROM public.platform_support_requests r
      JOIN public.organisations o ON o.id = r.org_id
 LEFT JOIN users u ON u.user_id = r.raised_by
"""


def _shape_ask(row) -> dict:
    return {
        "id": str(row["id"]),
        "ref": row["ref"],
        "org_id": str(row["org_id"]),
        "org_name": row["org_name"],
        # DERIVED, like `derive_state` above and for the same reason.
        "state": "answered" if row["answered"] else "open",
        "raised_by_name": row["raised_by_name"],
        "reason": row["reason"],
        # A HINT about where the customer thinks the problem is. Not a scope,
        # not approved by anybody, and read by nothing that decides authority.
        "modules_named": list(row["modules"] or ()),
        "raised_at": row["raised_at"].isoformat() if row["raised_at"] else None,
        "aekam_notified": row["aekam_notified"],
        # Said out loud on every row, because "a support request" is a phrase a
        # reader can easily take for access that already exists.
        "grants": "nothing",
    }


async def list_help_requests(
    pool, *, org_ids=None, open_only: bool = True,
) -> list[dict]:
    """Help requests, newest first. `org_ids=None` means EVERY organisation.

    `org_ids is None` is Aekam's queue and the ROUTER is the gate for it — the
    same division this file already uses for `list_all`. A caller that is not a
    platform role never reaches this function with None; it reaches it with the
    organisations they actually manage, re-derived from `user_roles` on the
    request.

    AN EMPTY `org_ids` LIST IS NOT `None`. It means "the orgs you manage, of
    which there are none", and it must answer `[]` rather than everything — the
    two are one `if org_ids:` away from each other and the wrong reading hands a
    stranger the whole platform's queue.

    `[]` when migration 182 is unapplied, which is production's state today.
    A 500 on a settings page because a migration has not run is not acceptable.
    """
    if org_ids is None:
        where, args = "TRUE", ()
    else:
        ids = [str(o) for o in org_ids]
        if not ids:
            return []
        where, args = "r.org_id = ANY($1::uuid[])", (ids,)

    if open_only:
        where = f"({where}) AND NOT {_ASK_ANSWERED}"

    try:
        rows = await pool.fetch(
            f"SELECT {_ASK_COLUMNS} {_ASK_FROM} "
            f" WHERE {where} "
            " ORDER BY r.raised_at DESC LIMIT 200",
            *args,
        )
    except _STORE_ABSENT:
        _note_requests_absent()
        return []
    return [_shape_ask(r) for r in rows]
