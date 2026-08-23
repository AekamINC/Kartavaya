"""
mentions.py — Parse @mentions in comment body, fan out notifications + emails.
Bug fixed: was importing _base from email_service which didn't exist as a
public export; switched to send_mention_email helper.
"""
import re
import uuid

from services.audit_actors import display_name

# Single-token handles: @alice, @alice.smith, @alice@example.com typed by hand.
# This CANNOT match a display name containing a space, which is why the
# member-name pass below exists — see _resolve_mentions.
MENTION_RE = re.compile(r'@([\w.-]+)')


async def _resolve_mentions(pool, body: str, team_id, actor_id: str | None = None):
    """
    Resolve @mentions to user rows.

    Two passes, because the picker and this parser disagreed about what a
    mention looks like:

    MentionTextarea inserts the member's FULL display name — `@{display_name} `
    (MentionTextarea.jsx) — and that display name is the one ladder in
    `services/audit_actors.display_name`, e.g. "Keval Shah". MENTION_RE stops at the space and captures only "Keval",
    and the lookup is an exact match on email/name/full_name, so "Keval" never
    matches "Keval Shah". The result was that picking a teammate from the
    @-autocomplete stored no mention row and sent no notification, no email and
    no push — for every user whose display name contains a space, which is
    nearly all of them. The failure was silent at both ends.

    Pass 1 matches team members by display name, longest first, so "@Keval Shah"
    wins over a bare "@Keval". Pass 2 keeps the original single-token behaviour
    for hand-typed handles and for anyone outside the task's team.
    """
    found = {}
    # What is still UNCLAIMED. Pass 1 blanks each span it matches, and pass 2
    # reads this rather than `body`, so a name already resolved in full cannot
    # be re-read as a shorter handle inside itself.
    residual = body.lower()

    # Pass 1 — project members, matched on their full display name.
    #
    # `public.project_assignments`, not `public.team_members`. This is PROJECT
    # membership — "who is on this task's project and may therefore be named in
    # its comments" — which is exactly what phase 2 of the tenancy cutover moves
    # onto `project_assignments`. Migration 195 made that table a strict superset
    # of the active rows in `team_members` (219 against 198, no unmatched row, no
    # role disagreement, measured 2026-08-22), so the candidate pool can only be
    # the same or larger: nobody who used to be mentionable stops being so.
    #
    # No `status` filter, because `project_assignments` has no status column — a
    # row IS the membership. `team_members` needed one to model a pending invite;
    # all 198 live rows are 'active' regardless.
    #
    # Schema-qualified: a `qa_cleanup_20260822.team_members` shadow table exists
    # in this database, and migration 142 is what this project learned about
    # unqualified names resolving into the wrong schema.
    #
    # ── THE DISPLAY LADDER, AND WHY IT NO LONGER ENDS AT AN EMAIL ───────────
    #
    # All three queries in this file resolved a person with
    # `COALESCE(full_name, name, email)`. THE OWNER RULED (2026-08-23) that a
    # display-name ladder must never end at an email address: Aekam must not see
    # client emails, and a person is named by their name — an email used as a
    # display fallback is a CONTACT DETAIL rendered as a LABEL, on a screen that
    # only ever wanted to say who somebody is.
    #
    # MEASURED FIRST, read-only, on the live database: **0 of 35 accounts** have
    # neither `full_name` nor `name`. The rung has never fired on real data, so
    # removing it changes nothing visible today — and it changes no MATCH
    # either, because the composer inserts whatever this same expression
    # produced and both sides now read it from one module.
    #
    # NOT LEFT BLANK — a blank reads as "nobody", a different and false claim —
    # so it ends at `'Unnamed member'`, the wording `routers/procurement.py:391`
    # already uses rather than a third phrasing invented beside it. The real
    # repair for a nameless account is giving the account a name.
    #
    # `u.email` IS STILL SELECTED AS ITS OWN COLUMN AND MUST STAY: it is the
    # address `send_mention_email` sends to, a contact detail used AS a contact
    # detail. Only the display ladder changed. `display_name` emits no `$n`, so
    # `$1` below is untouched.
    #
    # ── A TASK WITH NO PROJECT STILL HAS PEOPLE TO NAME ─────────────────────
    #
    # `team_id` is NULL for a PERSONAL task — somebody's own list, what the New
    # Task dropdown means by "Personal" (`server.py:4326`). There are 36 of them
    # on the live database. This pass used to be skipped entirely for all of
    # them, so a mention there could only ever fall through to pass 2's
    # single-token regex — which cannot match a display name containing a space,
    # and nearly every display name contains one. The composer still offered the
    # picker and still inserted "@Keval Shah", so the person typing had every
    # reason to believe they had summoned somebody. Nothing was stored, nothing
    # was sent, and nothing said so.
    #
    # The candidate pool for a task with no project is the people the ACTOR
    # shares an organisation with. Not "everybody": `ur.org_id IS NOT NULL` is
    # load-bearing, because in `user_roles` a NULL org_id is a PLATFORM grant —
    # a value, not an absence — and treating it as one would make every Aekam
    # staff account mentionable from every customer's private task, and every
    # customer's member mentionable by them.
    members = []
    if team_id:
        members = await pool.fetch(
            f"""
            SELECT u.user_id, u.email, {display_name('u')} AS display
            FROM public.project_assignments pa
            JOIN public.users u ON u.user_id = pa.user_id
            WHERE pa.team_id = $1::text
            """,
            team_id,
        )
    elif actor_id:
        members = await pool.fetch(
            f"""
            SELECT DISTINCT u.user_id, u.email, {display_name('u')} AS display
            FROM staging.user_roles mine
            JOIN staging.user_roles theirs ON theirs.org_id = mine.org_id
            JOIN public.users u ON u.user_id = theirs.user_id
            WHERE mine.user_id = $1
              AND mine.org_id IS NOT NULL
            """,
            actor_id,
        )

    if members:
        # Longest display name first: a member called "Keval" must not shadow
        # "Keval Shah" when both are on the team.
        for m in sorted(members, key=lambda r: len(r["display"] or ""), reverse=True):
            display = (m["display"] or "").strip()
            if not display:
                continue
            needle = f"@{display.lower()}"
            if needle in residual:
                found[m["user_id"]] = m
                # CONSUME the text this name matched. Sorting longest-first puts
                # "Keval Shah" ahead of "Keval", but ahead is not instead: a
                # bare "@Keval" is still a substring of "@Keval Shah", so both
                # matched and BOTH were notified — one of them a colleague who
                # was never named, told they had been. Blanking the span is what
                # makes longest-first actually mean "wins".
                residual = residual.replace(needle, " ")

    # Pass 2 — single-token handles, as before, but over what pass 1 LEFT.
    #
    # Reading `body` here undid pass 1's whole point: "@Keval Shah" resolves the
    # right person in pass 1, then MENTION_RE finds the bare "Keval" inside the
    # same words and `setdefault` adds a DIFFERENT colleague of that name — who
    # is then told they were summoned somewhere they were not named. The unit
    # test missed it because a fake pool has nobody called Keval; the live
    # database is where two people share a first name.
    for handle in set(MENTION_RE.findall(residual)):
        user = await pool.fetchrow(
            f"""
            SELECT user_id, email, {display_name('users')} AS display
            FROM users
            WHERE LOWER(email)=LOWER($1) OR LOWER(name)=LOWER($1) OR LOWER(full_name)=LOWER($1)
            """,
            handle,
        )
        if user:
            found.setdefault(user["user_id"], user)

    return list(found.values())


async def process_mentions(pool, comment_id: str, body: str, task_id: str, actor_id: str):
    if "@" not in body:
        return

    task  = await pool.fetchrow("SELECT team_id, title FROM tasks WHERE task_id=$1", task_id)
    # A DELETED actor returns no row at all, so `"Someone"` below still covers
    # that; `'Unnamed member'` covers only an account that exists without a name.
    actor = await pool.fetchrow(
        f"SELECT {display_name('users')} AS display FROM users WHERE user_id=$1", actor_id
    )
    actor_name = actor["display"] if actor else "Someone"

    for user in await _resolve_mentions(pool, body, task["team_id"] if task else None, actor_id):
        if user["user_id"] == actor_id:
            continue

        mention_id = f"ment_{uuid.uuid4().hex[:12]}"
        try:
            await pool.execute(
                "INSERT INTO mentions (mention_id, comment_id, mentioned_user_id, org_id) VALUES ($1,$2,$3,(SELECT org_id FROM task_comments WHERE comment_id=$2))",
                mention_id, comment_id, user["user_id"],
            )
        except Exception as exc:
            # This was a bare `except: pass`, and it is why the table was
            # trusted. MEASURED 2026-08-23: `public.mentions` holds ZERO rows,
            # all time, while 22 Sanvaad mentions notified people over the same
            # period — the shape of the report that a mention "only works in
            # Sanvaad". A row that fails to write must say so; the notification
            # below still goes out either way, because being told beats being
            # indexed.
            import logging
            logging.getLogger(__name__).warning(
                "mention row not stored for %s: %s", user["user_id"], exc)

        await pool.execute(
            """
            INSERT INTO notifications (notification_id, user_id, type, title, message, task_id, org_id)
            VALUES ($1,$2,'mention',$3,$4,$5,(SELECT org_id FROM tasks WHERE task_id=$5))
            """,
            f"notif_{uuid.uuid4().hex[:12]}",
            user["user_id"],
            f"You were mentioned in {task['title'] if task else 'a task'}",
            f"{actor_name} mentioned you in a comment.",
            task_id,
        )

        try:
            from email_service import send_mention_email
            send_mention_email(
                user["email"],
                user["display"],
                actor_name,
                task["title"] if task else "a task",
                task_id,
                body,
            )
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("mention email failed: %s", exc)

        try:
            from services.push_service import send_push
            import asyncio
            asyncio.ensure_future(send_push(
                pool,
                recipient_id=user["user_id"],
                kind="mention",
                title=f"You were mentioned in {task['title'] if task else 'a task'}",
                body=f"{actor_name} mentioned you in a comment.",
                task_id=task_id,
                is_mine=True,
            ))
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("mention push failed: %s", exc)
