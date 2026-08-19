"""offboarding.py — what a leaver still holds, as a query rather than a memo.

`staging.manav_offboarding` (migration 083) already covers the HR half of an
exit: exit type, notice, the clearance checklist, full-and-final settlement, the
exit interview. It covers none of the security half, and the security half is
the one with a clock on it:

  · WORK. Tasks still assigned to somebody who no longer works here, and clients
    they were the named contact for. Orphaned work does not announce itself —
    the task simply sits in a list nobody reads until the filing deadline goes
    past.
  · ACCESS. In a practice this is never one login. It is the role grant, the
    per-module grant, and a membership row in every team — three separate tables
    (probed 2026-08-19), any one of which left behind is a person with a live
    door into forty clients' data.

Both are checkable facts. So this module answers them, and migration 164 records
the answers.

── THE LOAD-BEARING PROBLEM: an employee is not a login ──────────────────────

`staging.manav_employees.user_id` is the intended bridge from an HR record to a
login. It is NULL on ALL 98 live rows, and NOT ONE of the 98 employee emails
matches a row in `public.users` (both probed against the live database on
2026-08-19). The HR module and the auth module have never been joined in this
database.

That is not a reason to return nothing. It is a reason to say so. `resolve_leaver`
reports HOW the login was found — 'linked', 'matched_by_email', or 'unresolved' —
and `open_custody` carries that value through, because "this person has no
outstanding access" and "we could not work out who this person logs in as" are
opposite answers and they look identical in any report that omits the field. On
today's data every real employee resolves to 'unresolved'; the queries below are
proven against the live database using the user ids that DO own work, and they
populate the moment one employee record is linked.

── WHY EMAIL MATCHING IS FENCED ──────────────────────────────────────────────

`public.users.email` carries a unique index and there are zero duplicate emails
today, so an email match cannot be ambiguous. It can still be CROSS-ORG: a
person with the same address in another tenant. So a match is accepted only if
that user is reachable inside this org — through a role grant, a module grant, a
team membership, or a task in one of this org's teams. Verified live: the check
returns True for a user in their own org and False for the same user against a
different org.

The task leg of that check matters. Reachability by role or membership alone
would fail for the exact person this module exists to find — the one whose
grants were already pulled but whose forty tasks were not — and would report
them clean.

── HOW A TASK REACHES AN ORG ─────────────────────────────────────────────────

`public.tasks` has NO org_id. It reaches one only through
`tasks.team_id = teams.team_id` (both text) and `teams.org_id`. This is the join
`analytics/metrics/core.py`, `services/skills/data/my_desk.py` and
`services/niyam/predicates.py` all use, and it is followed here rather than
reinvented. 698 of the 735 live task rows reach an org this way; the 37 that do
not have no team and therefore belong to no tenant, so they are correctly
invisible to an org-scoped query.

Assignment is read from BOTH `assignee_user_ids` (text[], set on 645 rows) and
`user_id` (text, set on 337). The union is deliberate: this query's failure mode
is MISSING a leaver's open work, so it is read widely and de-duplicated, not
narrowly and cleanly.

── WHAT "A CLIENT NAMED TO THEM" ACTUALLY IS ─────────────────────────────────

`staging.graha_clients` has NO owner, account-manager or assigned_to column, and
nothing in `custom_data` on any of the 91 live rows names one. There is no column
to read. Client ownership in this schema is DERIVED, exactly as sales customers
are: a person is named to a client through the open deals and the contacts they
are assigned to at that client. That derivation is what `outstanding_clients`
returns, with the count of each so a reader can see why the client appeared.

── NAMES, NOT IDS ────────────────────────────────────────────────────────────

Every row returned here carries a human label — `title`, `client_name`,
`team_name`, `label`. The machine handles a caller needs in order to actually
reassign or revoke something are carried separately and are always suffixed
`_ref`. The rule for anything downstream: display the label, pass the ref. No
`*_ref` value is ever rendered.

── INTEGRATION POINT: DSC tokens and client portal credentials ───────────────

The brief names DSC tokens and portal credentials as things a leaver holds, and
it is right — every Indian practice-management competitor sells a DSC register.

NOTHING IS QUERIED FOR THEM HERE, deliberately, and there are two separate
reasons.

Portal credentials: no per-person credential table exists in either schema
(checked 2026-08-19). The only credential table is
`staging.hub_connector_credentials`, which is a per-ORG social-publishing
credential. Reading it here would report every org's Instagram token as
something a departing articled clerk was holding.

DSC tokens: a register is arriving — `staging.dsc_register`, migration 160,
written concurrently and NOT YET APPLIED. It is not wired in because of how it
keys custody: the holder is `custody_holder_name TEXT`, a person's NAME, with no
column for a login id or an employee id. Joining a leaver to it would mean
matching `manav_employees.name` against free text, and a name match that fires
wrongly reports a person as holding a client's signing key when they do not —
which is a worse failure than the silence it replaces. WIRING IT NEEDS A KEY,
not a cleverer LIKE.

Migration 164 already accepts `subject_type IN ('portal_credential','dsc_token')`
in the ledger, so a firm can record both by hand today and `open_custody` will
refuse to report the exit clear while either line is outstanding — proven by
`test_an_outstanding_ledger_line_keeps_the_exit_unclear`.

WHEN EITHER GAINS A KEY: add a leg to `live_access` reading it by the resolved
login id (or a real employee_id column on dsc_register), and add its subject_type
to `_ACCESS_SUBJECT_TYPES` below so already-recorded revocations suppress it.
Nothing else in this module needs to change.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

log = logging.getLogger(__name__)

#: Ceiling on any one list. High enough that a real leaver's whole desk fits —
#: the largest live assignment to one person is well under this — and low enough
#: that a mis-scoped call cannot stream the entire task table into a response.
MAX_ROWS = 500

#: Task states that are NOT outstanding work. 'cancelled' is not currently used
#: by any live row (the live distribution is done/todo/in_progress/in_review/
#: requested) but it is excluded anyway: a cancelled task handed to a successor
#: is noise, and the day the status appears this query should already be right.
#:
#: BOUND, never interpolated. Rendering this tuple into the SQL text works today
#: and stops working the moment somebody deletes one entry: Python renders a
#: one-element tuple as ('done',) and the trailing comma is a syntax error that
#: PgBouncer returns as an instant, message-less 500 — the failure mode that has
#: already cost this repo one incident (see the credits-SQL note in record_custody).
#: A text[] bind is the same query with no way to spell it wrong.
_CLOSED_TASK_STATUSES = ("done", "cancelled")

#: The subject_type vocabulary, mirroring the CHECK constraint in migration 164.
#: Kept here so a typo is a ValueError from record_custody rather than a
#: CheckViolation surfacing as a 500 — and, worse, so a near-miss that IS in the
#: vocabulary ('module' for 'module_grant') cannot be written as a line that then
#: silently fails to suppress the grant it was meant to settle.
#: KEEP IN STEP WITH manav_offboarding_custody_subject_ck IN MIGRATION 164.
_SUBJECT_TYPES = (
    "task", "client", "deal", "contact", "follow_up",
    "role_grant", "module_grant", "team_membership",
    "portal_credential", "dsc_token", "device", "other",
)

#: The subject_type values that `live_access` can produce. Used to suppress an
#: access line that migration 164's ledger already records as revoked. Extend
#: this when a new access leg is added, or the new leg will keep reappearing as
#: outstanding after somebody has revoked it.
_ACCESS_SUBJECT_TYPES = ("role_grant", "module_grant", "team_membership")


# ── the leaver ───────────────────────────────────────────────────────────────

_LEAVER_SQL = """
SELECT e.id            AS employee_ref,
       e.name          AS employee_name,
       e.employee_code AS employee_code,
       e.designation   AS designation,
       e.department    AS department,
       e.email         AS email,
       e.user_id       AS linked_user_id,
       e.status        AS employment_status,
       e.is_active     AS is_active,
       o.id            AS offboarding_ref,
       o.status        AS offboarding_status,
       o.exit_type     AS exit_type,
       o.last_working_day        AS last_working_day,
       o.handover_completed_at   AS handover_completed_at,
       o.access_revoked_at       AS access_revoked_at,
       o.custody_scanned_at      AS custody_scanned_at
FROM staging.manav_employees e
LEFT JOIN staging.manav_offboarding o
       ON o.employee_id = e.id
      AND o.org_id = e.org_id
      AND o.status <> 'cancelled'
WHERE e.org_id = $1::uuid
  AND e.id = $2::uuid
"""

_USER_BY_EMAIL_SQL = """
SELECT u.user_id, COALESCE(NULLIF(u.full_name, ''), u.name) AS name
FROM public.users u
WHERE lower(u.email) = lower($1::text)
LIMIT 1
"""

#: Is this login reachable inside this org at all? See the module docstring for
#: why the task leg is in here and not left out as redundant.
_REACHABLE_SQL = """
SELECT EXISTS (SELECT 1 FROM staging.user_roles r
                WHERE r.org_id = $1::uuid AND r.user_id = $2::text)
    OR EXISTS (SELECT 1 FROM staging.org_member_modules m
                WHERE m.org_id = $1::uuid AND m.user_id = $2::text)
    OR EXISTS (SELECT 1 FROM public.team_members mem
                 JOIN public.teams t ON t.team_id = mem.team_id
                WHERE t.org_id = $1::uuid AND mem.user_id = $2::text)
    OR EXISTS (SELECT 1 FROM public.tasks tk
                 JOIN public.teams t2 ON t2.team_id = tk.team_id
                WHERE t2.org_id = $1::uuid
                  AND ($2::text = ANY(tk.assignee_user_ids) OR tk.user_id = $2::text))
"""


async def resolve_leaver(pool, org_id: str, employee_id: str) -> Optional[dict]:
    """The employee, their exit record if one exists, and their login if findable.

    Returns None when the employee does not exist IN THIS ORG. That is the whole
    of the tenancy guard for this module: every other function takes the resolved
    login id from here, so an employee id belonging to another firm never gets
    past this line and no query below can be reached with it.

    `login_link` is one of:
      'linked'           — manav_employees.user_id was set.
      'matched_by_email' — matched public.users.email AND reachable in this org.
      'unresolved'       — no login could be established. Every list is then
                           empty, and the caller MUST show that as unknown
                           rather than as clear. True for all 98 live employees
                           today; see the module docstring.
    """
    row = await pool.fetchrow(_LEAVER_SQL, org_id, employee_id)
    if not row:
        return None
    row = dict(row)

    login_user_id: Optional[str] = (row.get("linked_user_id") or "").strip() or None
    login_link = "linked" if login_user_id else "unresolved"
    login_name: Optional[str] = None

    if not login_user_id:
        email = (row.get("email") or "").strip()
        if email:
            hit = await pool.fetchrow(_USER_BY_EMAIL_SQL, email)
            if hit:
                candidate = dict(hit)["user_id"]
                # A unique email is not a unique TENANT. Without this check a
                # namesake in another firm would hand us their tasks and their
                # grants under this org's employee record.
                if await pool.fetchval(_REACHABLE_SQL, org_id, candidate):
                    login_user_id = candidate
                    login_name = dict(hit).get("name")
                    login_link = "matched_by_email"

    return {
        "employee_name": row.get("employee_name"),
        "employee_code": row.get("employee_code"),
        "designation": row.get("designation"),
        "department": row.get("department"),
        "employment_status": row.get("employment_status"),
        "is_active": row.get("is_active"),
        "exit_type": row.get("exit_type"),
        "offboarding_status": row.get("offboarding_status"),
        "last_working_day": row.get("last_working_day"),
        "handover_completed_at": row.get("handover_completed_at"),
        "access_revoked_at": row.get("access_revoked_at"),
        "custody_scanned_at": row.get("custody_scanned_at"),
        "login_link": login_link,
        "login_name": login_name,
        # Machine handles. Never rendered — see NAMES, NOT IDS above.
        "employee_ref": row.get("employee_ref"),
        "offboarding_ref": row.get("offboarding_ref"),
        "login_user_ref": login_user_id,
    }


# ── outstanding work ─────────────────────────────────────────────────────────

_TASKS_SQL = """
SELECT t.task_id  AS task_ref,
       t.title    AS title,
       t.status   AS status,
       t.priority AS priority,
       t.due_at   AS due_at,
       tm.name    AS team_name
FROM public.tasks t
JOIN public.teams tm ON tm.team_id = t.team_id
WHERE tm.org_id = $1::uuid
  AND tm.deleted_at IS NULL
  AND t.archived_at IS NULL
  AND t.status <> ALL($3::text[])
  AND ($2::text = ANY(t.assignee_user_ids) OR t.user_id = $2::text)
ORDER BY t.due_at ASC NULLS LAST, t.title ASC
LIMIT $4::int
"""


async def outstanding_tasks(
    pool, org_id: str, login_user_id: str, *, limit: int = MAX_ROWS
) -> list[dict]:
    """Open tasks still pointed at the leaver, org-scoped through teams.org_id.

    Archived tasks are excluded (246 of 735 live rows are archived) — an archived
    task is not work anybody is waiting on, and including them would bury the
    handful that matter.
    """
    if not login_user_id:
        return []
    rows = await pool.fetch(
        _TASKS_SQL,
        org_id,
        login_user_id,
        list(_CLOSED_TASK_STATUSES),
        min(int(limit), MAX_ROWS),
    )
    return [dict(r) for r in rows]


#: Derived client ownership. See "WHAT A CLIENT NAMED TO THEM ACTUALLY IS".
#: Won and lost deals are excluded: a closed deal names nobody going forward, and
#: including them would list every client the leaver ever touched as outstanding.
_CLIENTS_SQL = """
SELECT c.id   AS client_ref,
       c.name AS client_name,
       count(*) FILTER (WHERE s.src = 'deal')    AS open_deals,
       count(*) FILTER (WHERE s.src = 'contact') AS named_contacts
FROM (
    SELECT d.client_id AS cid, 'deal'::text AS src
      FROM staging.graha_deals d
     WHERE d.org_id = $1::uuid
       AND d.assigned_to = $2::text
       AND d.client_id IS NOT NULL
       AND d.is_active
       AND d.archived_at IS NULL
       AND d.won_at IS NULL
       AND d.lost_at IS NULL
    UNION ALL
    SELECT ct.client_id, 'contact'::text
      FROM staging.graha_contacts ct
     WHERE ct.org_id = $1::uuid
       AND ct.assigned_to = $2::text
       AND ct.client_id IS NOT NULL
       AND ct.is_active
       -- A merged contact is a duplicate that has already been folded into
       -- another row. Counting it names the leaver to a client twice.
       AND ct.merged_into_id IS NULL
) s
JOIN staging.graha_clients c ON c.id = s.cid AND c.org_id = $1::uuid
GROUP BY c.id, c.name
ORDER BY c.name ASC
LIMIT $3::int
"""


async def outstanding_clients(
    pool, org_id: str, login_user_id: str, *, limit: int = MAX_ROWS
) -> list[dict]:
    """Clients the leaver is still the named person for, derived from CRM rows."""
    if not login_user_id:
        return []
    rows = await pool.fetch(_CLIENTS_SQL, org_id, login_user_id, min(int(limit), MAX_ROWS))
    return [dict(r) for r in rows]


#: Follow-ups are the dated half of client work and they are the item that
#: actually goes stale: 91 open ones are assigned to somebody live today. The
#: client name is LEFT JOINed twice over because a follow-up hangs off a contact,
#: and a contact need not belong to a client.
_FOLLOW_UPS_SQL = """
SELECT f.id     AS follow_up_ref,
       f.title  AS title,
       f.due_at AS due_at,
       c.name   AS client_name,
       ct.name  AS contact_name
FROM staging.graha_follow_ups f
LEFT JOIN staging.graha_contacts ct ON ct.id = f.contact_id AND ct.org_id = $1::uuid
LEFT JOIN staging.graha_clients  c  ON c.id  = ct.client_id AND c.org_id  = $1::uuid
WHERE f.org_id = $1::uuid
  AND f.assigned_to = $2::text
  AND f.is_completed = FALSE
ORDER BY f.due_at ASC NULLS LAST
LIMIT $3::int
"""


async def outstanding_follow_ups(
    pool, org_id: str, login_user_id: str, *, limit: int = MAX_ROWS
) -> list[dict]:
    """Open CRM follow-ups still assigned to the leaver."""
    if not login_user_id:
        return []
    rows = await pool.fetch(_FOLLOW_UPS_SQL, org_id, login_user_id, min(int(limit), MAX_ROWS))
    return [dict(r) for r in rows]


# ── access still live ────────────────────────────────────────────────────────

#: Three tables, because access in this product is three separate grants and
#: pulling one does not pull the others. `user_roles` is the tenant path,
#: `org_member_modules` is per-module entitlement, and `team_members` is the row
#: that actually puts a person inside a team's data. All 201 live team_members
#: rows carry a user_id and status 'active', so the match needs no email fallback.
#:
#: OUT OF SCOPE ON PURPOSE — Aekam's own platform grants. Ten live user_roles
#: rows carry org_id NULL with role_code platform_admin / platform_manager /
#: platform_staff (probed 2026-08-19); they belong to no tenant, so every leg
#: below filters them out. That is right for a firm offboarding its own staff,
#: and WRONG for Aekam offboarding its own: this module would report such a
#: person's access as empty. Widening the filter is not the fix — it would make
#: one org's query read another's grants. A platform-staff exit needs its own
#: org-less path, and until it exists that revocation is recorded by hand in the
#: ledger, where an outstanding line still blocks `clear`.
_ACCESS_SQL = """
SELECT 'role_grant'::text AS access_kind,
       r.role_code        AS label,
       r.role_code        AS access_ref,
       r.granted_at       AS granted_at
  FROM staging.user_roles r
 WHERE r.org_id = $1::uuid AND r.user_id = $2::text
UNION ALL
SELECT 'module_grant', m.module_code, m.module_code, m.granted_at
  FROM staging.org_member_modules m
 WHERE m.org_id = $1::uuid AND m.user_id = $2::text
UNION ALL
SELECT 'team_membership', tm.name, tm.team_id, mem.created_at
  FROM public.team_members mem
  JOIN public.teams tm ON tm.team_id = mem.team_id
 WHERE tm.org_id = $1::uuid
   AND tm.deleted_at IS NULL
   AND mem.user_id = $2::text
   AND mem.status = 'active'
ORDER BY 1 ASC, 2 ASC
"""

#: access_kind -> the ledger's subject_type. They are the same words with
#: different spellings on purpose: `access_kind` describes a live grant,
#: `subject_type` describes a line in the register.
_ACCESS_KIND_TO_SUBJECT = {
    "role_grant": "role_grant",
    "module_grant": "module_grant",
    "team_membership": "team_membership",
}


async def live_access(pool, org_id: str, login_user_id: str) -> list[dict]:
    """Every grant this login still holds in this org. Unfiltered by the ledger.

    See `unrevoked_access` for the version that subtracts what has already been
    recorded as revoked.
    """
    if not login_user_id:
        return []
    rows = await pool.fetch(_ACCESS_SQL, org_id, login_user_id)
    return [dict(r) for r in rows]


# ── the register ─────────────────────────────────────────────────────────────

_LEDGER_SQL = """
SELECT action, subject_type, subject_ref, subject_label,
       -- Aliased, not passed through. The stored column is a raw login id and
       -- the rule stated at the top of this module is that a renderer displays
       -- every key EXCEPT the ones suffixed `_ref`. Returning it under its
       -- column name would hand a downstream template a login id wearing a name
       -- that reads like a display field — which is how an id ends up on screen.
       -- `reassigned_to_name` is the one to show.
       reassigned_to_user_id AS reassigned_to_user_ref,
       reassigned_to_name,
       revoked_at, revoked_by, status, waived_reason, note,
       recorded_by, created_at, updated_at
FROM staging.manav_offboarding_custody
WHERE org_id = $1::uuid AND offboarding_id = $2::uuid
ORDER BY action ASC, subject_type ASC, subject_label ASC
"""


async def custody_ledger(pool, org_id: str, offboarding_ref: str) -> list[dict]:
    """Everything already recorded against one exit — reassigned, revoked, waived."""
    if not offboarding_ref:
        return []
    rows = await pool.fetch(_LEDGER_SQL, org_id, offboarding_ref)
    return [dict(r) for r in rows]


def _settled(ledger: list[dict], action: str) -> set[tuple[str, str]]:
    """(subject_type, subject_ref) pairs this ledger considers finished.

    'waived' counts as settled. A firm that has written down WHY a line will not
    be actioned has dealt with it, and re-raising it every scan trains people to
    ignore the whole register — which is the failure mode that kills a checklist.
    """
    out: set[tuple[str, str]] = set()
    for row in ledger:
        if row.get("action") != action:
            continue
        if row.get("status") not in ("done", "waived"):
            continue
        ref = row.get("subject_ref")
        if ref is None:
            # A free-text line (a drawer key) matches no queried subject, so it
            # can never suppress one. Skipped rather than keyed on the label,
            # which a human can retype differently every time.
            continue
        out.add((row.get("subject_type"), str(ref)))
    return out


def unrevoked_access(access: list[dict], ledger: list[dict]) -> list[dict]:
    """Live grants minus the ones the register already records as revoked.

    Pure, and deliberately not a SQL anti-join. This is the one piece of logic
    here that decides whether a person is reported as still holding a key, and a
    mock pool hides bad SQL — pushing it into the query would leave it asserted
    by nothing. The SQL above is proven against the live database instead; this
    is proven by the tests.
    """
    settled = _settled(ledger, "revoke")
    kept = []
    for grant in access:
        subject = _ACCESS_KIND_TO_SUBJECT.get(grant.get("access_kind"))
        ref = grant.get("access_ref")
        if subject and ref is not None and (subject, str(ref)) in settled:
            continue
        kept.append(grant)
    return kept


def unreassigned(items: list[dict], ledger: list[dict], subject_type: str, ref_key: str) -> list[dict]:
    """Work items minus the ones the register already records as handed over."""
    settled = _settled(ledger, "reassign")
    kept = []
    for item in items:
        ref = item.get(ref_key)
        if ref is not None and (subject_type, str(ref)) in settled:
            continue
        kept.append(item)
    return kept


# ── the whole picture ────────────────────────────────────────────────────────

async def open_custody(
    pool, org_id: str, employee_id: str, *, limit: int = MAX_ROWS
) -> Optional[dict]:
    """Everything still outstanding for one departing employee, in one call.

    Returns None ONLY when the employee does not exist in this org — which is
    also how a leaver from another firm is refused. An employee who exists and
    has nothing outstanding gets a full dict with four EMPTY LISTS and
    `clear: True`, never an error and never None: "nothing to do" is an answer
    this register has to be able to give, and a caller that has to catch an
    exception to learn it will stop calling.

    `clear` is True only when nothing is outstanding AND the login was resolved.
    An unresolved login means the four lists are empty because nobody could be
    looked up, not because the desk is empty, and reporting that as clear is the
    one wrong answer this module could give.
    """
    leaver = await resolve_leaver(pool, org_id, employee_id)
    if leaver is None:
        return None

    login_user_id = leaver.get("login_user_ref")
    offboarding_ref = leaver.get("offboarding_ref")

    ledger = await custody_ledger(pool, org_id, offboarding_ref) if offboarding_ref else []

    tasks = await outstanding_tasks(pool, org_id, login_user_id, limit=limit)
    clients = await outstanding_clients(pool, org_id, login_user_id, limit=limit)
    follow_ups = await outstanding_follow_ups(pool, org_id, login_user_id, limit=limit)
    access = await live_access(pool, org_id, login_user_id)

    tasks = unreassigned(tasks, ledger, "task", "task_ref")
    clients = unreassigned(clients, ledger, "client", "client_ref")
    follow_ups = unreassigned(follow_ups, ledger, "follow_up", "follow_up_ref")
    access = unrevoked_access(access, ledger)

    outstanding_ledger = [r for r in ledger if r.get("status") == "outstanding"]

    counts = {
        "tasks": len(tasks),
        "clients": len(clients),
        "follow_ups": len(follow_ups),
        "access": len(access),
        "ledger_outstanding": len(outstanding_ledger),
    }
    nothing_open = not any(counts.values())

    return {
        "leaver": leaver,
        "tasks": tasks,
        "clients": clients,
        "follow_ups": follow_ups,
        "access": access,
        "ledger_outstanding": outstanding_ledger,
        "counts": counts,
        "clear": bool(nothing_open and login_user_id),
        # The honest caveat, carried in the payload so no caller has to remember
        # to check `login_link` themselves before believing `clear`.
        "unknown": leaver.get("login_link") == "unresolved",
    }


async def inherited_by(pool, org_id: str, user_id: str) -> list[dict]:
    """What one person has been handed from other people's exits.

    The other direction through the same register, and the reason migration 164
    is a table rather than more jsonb on the exit row. A successor who quietly
    absorbed four leavers' client lists is a capacity problem and a key-person
    risk, and nothing else in this product can see it.
    """
    if not user_id:
        return []
    rows = await pool.fetch(
        """
        SELECT c.subject_type, c.subject_label, c.status, c.created_at,
               e.name AS from_employee_name
        FROM staging.manav_offboarding_custody c
        LEFT JOIN staging.manav_employees e
               ON e.id = c.employee_id AND e.org_id = c.org_id
        WHERE c.org_id = $1::uuid
          AND c.action = 'reassign'
          AND c.reassigned_to_user_id = $2::text
        ORDER BY c.created_at DESC
        LIMIT $3::int
        """,
        org_id,
        user_id,
        MAX_ROWS,
    )
    return [dict(r) for r in rows]


# ── the one write ────────────────────────────────────────────────────────────

#: The only write in this module, and therefore the only place org scoping is
#: not already guaranteed by a WHERE clause. migration 164 puts no foreign key on
#: this table (the subjects span two schemas and key on different types), so an
#: INSERT ... VALUES would write whatever org_id the caller passed against
#: whatever offboarding_id the caller passed, with nothing checking that the two
#: belong together — one transposed argument in a future router and firm A's
#: register grows a line about firm B's exit.
#:
#: So it is INSERT ... SELECT instead: the row is sourced from the exit record
#: itself, and the WHERE proves all three of (org, exit, employee) agree before
#: any row exists to insert. A mismatched triple selects nothing, inserts
#: nothing, and returns None — a refusal, not a misfiled row.
_RECORD_SQL = """
INSERT INTO staging.manav_offboarding_custody
    (org_id, offboarding_id, employee_id, action, subject_type, subject_ref,
     subject_label, reassigned_to_user_id, reassigned_to_name,
     revoked_at, revoked_by, status, waived_reason, note, recorded_by)
SELECT $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
       $7::text, $8::text, $9::text,
       $10::timestamptz, $11::text, $12::text, $13::text, $14::text, $15::text
  FROM staging.manav_offboarding o
 WHERE o.id = $2::uuid
   AND o.org_id = $1::uuid
   AND o.employee_id = $3::uuid
ON CONFLICT (org_id, offboarding_id, action, subject_type, subject_ref)
    WHERE subject_ref IS NOT NULL
DO UPDATE SET
    subject_label         = EXCLUDED.subject_label,
    reassigned_to_user_id = EXCLUDED.reassigned_to_user_id,
    reassigned_to_name    = EXCLUDED.reassigned_to_name,
    revoked_at            = EXCLUDED.revoked_at,
    revoked_by            = EXCLUDED.revoked_by,
    status                = EXCLUDED.status,
    waived_reason         = EXCLUDED.waived_reason,
    note                  = EXCLUDED.note,
    recorded_by           = EXCLUDED.recorded_by,
    updated_at            = now()
RETURNING id, action, subject_type, subject_label, status
"""


async def record_custody(
    pool,
    org_id: str,
    offboarding_ref: str,
    employee_ref: str,
    *,
    action: str,
    subject_type: str,
    subject_label: str,
    subject_ref: Optional[str] = None,
    reassigned_to_user_id: Optional[str] = None,
    reassigned_to_name: Optional[str] = None,
    revoked_at: Any = None,
    revoked_by: Optional[str] = None,
    status: str = "outstanding",
    waived_reason: Optional[str] = None,
    note: Optional[str] = None,
    recorded_by: Optional[str] = None,
) -> Optional[dict]:
    """Record one custody line. Upserts on (exit, action, subject_type, ref).

    The upsert is what makes a repeated scan safe. Without it, opening the exit
    screen twice writes the leaver's whole desk into the register twice, and by
    the fourth visit the count of outstanding items is four times the truth.

    Every parameter is cast at the bind site. An untyped `$1` reaching PgBouncer
    through this codebase's pooler produces a parse error that surfaces as an
    instant 500 with no useful message — that has cost a real incident here.

    `subject_label` is required and must be non-empty: it is the only field this
    row will ever be displayed by, and a row that cannot be labelled would have
    to be rendered as a raw uuid.

    Returns None when (org_id, offboarding_ref, employee_ref) do not describe one
    real exit — see the note on _RECORD_SQL. A caller MUST treat None as a
    refusal and not as "already recorded".
    """
    if action not in ("reassign", "revoke"):
        raise ValueError(f"action must be 'reassign' or 'revoke', got {action!r}")
    if not (subject_label or "").strip():
        raise ValueError("subject_label is required — this row is displayed by it")
    if status not in ("outstanding", "done", "waived"):
        raise ValueError(f"unknown status {status!r}")
    # Checked here rather than left to the CHECK constraint: a constraint
    # violation arrives as an asyncpg error a router turns into a 500, and the
    # near-miss case ('module' for 'module_grant') would be a valid-looking line
    # that never settles the grant it names. See _SUBJECT_TYPES.
    if subject_type not in _SUBJECT_TYPES:
        raise ValueError(
            f"unknown subject_type {subject_type!r} — expected one of {_SUBJECT_TYPES}"
        )

    row = await pool.fetchrow(
        _RECORD_SQL,
        org_id,
        offboarding_ref,
        employee_ref,
        action,
        subject_type,
        subject_ref,
        subject_label,
        reassigned_to_user_id,
        reassigned_to_name,
        revoked_at,
        revoked_by,
        status,
        waived_reason,
        note,
        recorded_by,
    )
    return dict(row) if row else None
