"""
audit_actors — the created-by / updated-by SQL, written once.

WHY THIS EXISTS
---------------
Migrations 201 and 202 put `created_by` on 77 tables and `updated_by` on 65.
Every one of them stores `public.users.user_id` — TEXT, like
`user_f1a0a472b98f`. That value MUST NOT reach the screen: it is a member id,
and the product's rule is that a user, member or org id is never rendered
(`frontend/scripts/check-rendered-ids.mjs` is the ratchet).

So every list endpoint that wants to show an author has to LEFT JOIN
`public.users` twice, coalesce a display name out of two nullable columns, and
emit a separate boolean saying whether an actor was recorded at all. Left to
each router that is roughly twenty hand-written copies of the same four lines,
and the first time one of them differs it will differ in the direction that
leaks an email address.

It differed once already, before this module existed. `routers/graha.py:1466`
does:

    COALESCE(u.full_name, u.name, u.email) AS created_by_name

— so a user row with no name silently prints that person's EMAIL into a table
column. That is the platform-privacy rule inverted (Aekam must not see client
emails, and a tenant's table is not a directory of them either). The ladder here
stops at names, deliberately, and `routers/ganit.py:490` already followed it
by hand; this module is that same fragment with one owner.

WHAT IT EMITS, AND WHY THE BOOLEAN MATTERS
------------------------------------------
For an alias `e` over a table carrying `created_by`:

    <name>_name    the resolved display name, or NULL
    has_creator    whether an actor id is recorded AT ALL

Those are two different absences and the UI renders them differently —
`ByCell` shows an em dash for "no person is recorded against this record" and
the word `unknown` for "there is an id here, but no user row behind it any
more" (a deleted account). Collapsing them into one NULL name throws away the
difference between "nobody did this" and "we can no longer say who", which is
exactly the distinction an audit column exists to preserve.

NAME LADDER
-----------
`btrim` then `NULLIF(…, '')` on both columns, because `users.name` is NOT NULL
in places and an empty string is not a name — coalescing on NULL alone would
render a blank cell that reads as a person with no name rather than as an
unresolvable id.

NO BIND PARAMETERS PASS THROUGH HERE
------------------------------------
Everything this module returns is composed from ITS OWN string constants plus
the caller's table alias, which is a literal in the router source and never
request data. It adds no `$n` placeholders, so it cannot disturb a caller's
parameter numbering and cannot introduce an untyped parameter expression —
the thing PgBouncer turns into an instant 500. If you ever find yourself
wanting to pass a value in here, that value belongs in the caller's params
list, not in this string.
"""

from __future__ import annotations

# The one place the ladder is written. Names only — never `u.email`.
_NAME = (
    "COALESCE(NULLIF(btrim({u}.name), ''), NULLIF(btrim({u}.full_name), ''))"
)

# The join aliases. Two are needed because a row's creator and its last editor
# are different people often enough that one join cannot serve both, and
# `public.users` must be joined once per actor column.
CREATOR_ALIAS = "_cu"
UPDATER_ALIAS = "_uu"


def actor_select(alias: str, *, created: bool = True, updated: bool = False) -> str:
    """
    The SELECT fragment, comma-TERMINATED so it drops into a column list.

        "SELECT e.id, e.title, "
        + actor_select("e", updated=True)
        + "COUNT(*) OVER() AS _total "

    Returns "" when both flags are false, so a caller can pass the flags
    through from a feature check without branching around the concatenation.
    """
    parts: list[str] = []
    if created:
        parts.append(f"{_NAME.format(u=CREATOR_ALIAS)} AS created_by_name")
        parts.append(f"({alias}.created_by IS NOT NULL) AS has_creator")
    if updated:
        parts.append(f"{_NAME.format(u=UPDATER_ALIAS)} AS updated_by_name")
        parts.append(f"({alias}.updated_by IS NOT NULL) AS has_updater")
    if not parts:
        return ""
    return ", ".join(parts) + ", "


def actor_joins(alias: str, *, created: bool = True, updated: bool = False) -> str:
    """
    The LEFT JOINs, space-terminated, to sit after the caller's own FROM/JOINs
    and before its WHERE.

    LEFT and never INNER: a record whose author has since been deleted must
    still appear in the list. An inner join here would make rows VANISH when an
    employee leaves, which is a data-loss bug that looks like a filter working.

    `public.users` is schema-qualified. Migration 142 exists because a query
    that relied on `search_path` found a shadow table in the other schema.
    """
    out = ""
    if created:
        out += (
            f"LEFT JOIN public.users {CREATOR_ALIAS} "
            f"ON {CREATOR_ALIAS}.user_id = {alias}.created_by "
        )
    if updated:
        out += (
            f"LEFT JOIN public.users {UPDATER_ALIAS} "
            f"ON {UPDATER_ALIAS}.user_id = {alias}.updated_by "
        )
    return out


# Sort keys a list endpoint may accept for these columns. A server-side
# ALLOWLIST — the router looks a client-supplied sort key up in a dict like
# this one and never interpolates the string it was given, which is the rule
# for every dynamic identifier in this codebase.
ACTOR_SORT_KEYS = {
    "created_at": "created_at",
    "updated_at": "updated_at",
    "created_by_name": "created_by_name",
    "updated_by_name": "updated_by_name",
}


# ── THE DISPLAY LADDER, for every screen that names a person ────────────────
#
# `actor_select` above answers "who created/updated this ROW". This is the
# same rule for the other ~60 places that name a person for a different reason
# — a message sender, a task assignee, a report's rows, a mention, a leaderboard
# — and it exists because those places had ALL written the ladder as:
#
#     COALESCE(u.full_name, u.name, u.email)
#
# THE OWNER'S RULING (2026-08-23): the ladder must never end at an email
# address. Two standing rules meet here and point the same way — Aekam must not
# see client emails, and a person is named by their name. An email as a display
# fallback is a CONTACT DETAIL rendered as a LABEL, on a screen that only ever
# wanted to say who somebody is.
#
# MEASURED BEFORE CHANGING IT, because the objection to removing the rung is
# "then some rows will show nothing": on the live database, **0 of 35 accounts**
# have neither `full_name` nor `name`. The email rung has therefore never fired
# on real data, and removing it changes nothing anybody can see today. It was
# not a working fallback; it was a loaded gun.
#
# WHY NOT BLANK. A blank cell reads as "nobody did this", which is a different
# and false claim — the same distinction `ByCell` draws between an em dash and
# `unknown`. So the ladder ends at a stated, non-identifying label.
#
# `'Unnamed member'` is NOT a new phrasing. `routers/procurement.py:391` already
# ends its member picker exactly this way, and for exactly this reason, in a
# docstring that says a customer's member emails must not be visible and a
# picker does not need one. This is that line, promoted to the place everybody
# reads from, rather than a third wording invented alongside it.
#
# `btrim` + `NULLIF` on both columns, not plain COALESCE: `users.name` is NOT
# NULL in places, and an empty string is not a name. Coalescing on NULL alone
# renders a blank that reads as a person with no name rather than as a person
# whose name we do not hold.
#
# The real repair for a nameless account is that the account has no name. This
# label surfaces that; it does not paper over it.
UNNAMED = "Unnamed member"

_DISPLAY = (
    "COALESCE(NULLIF(btrim({u}.full_name), ''), NULLIF(btrim({u}.name), ''), "
    "'" + UNNAMED + "')"
)


def display_name(alias: str = "u") -> str:
    """
    The person-name expression for one `public.users` alias, with no trailing
    comma and no alias of its own — the caller names the output column, because
    these sites call it `sender_name`, `actor_name`, `owner_name`,
    `salesperson_name` and a dozen other things, and renaming them would be a
    contract change to every screen rather than a privacy fix.

        "SELECT " + display_name("u") + " AS sender_name, … "

    Emits no bind parameter, so it cannot disturb a caller's `$n` numbering.

    NOTE THE COLUMN ORDER differs from `actor_select`'s ladder above, which
    prefers `name` over `full_name`. That is not an inconsistency to tidy: the
    audit columns were shipped preferring `name` and every screen reading them
    was signed off on that, while these ~60 display sites were all written
    preferring `full_name`. Flipping either one silently changes the name shown
    beside somebody's work. The property that matters — and the only one that
    was ever broken — is that NEITHER ladder reaches an email address.
    """
    return _DISPLAY.format(u=alias)
