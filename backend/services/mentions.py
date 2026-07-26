"""
mentions.py — Parse @mentions in comment body, fan out notifications + emails.
Bug fixed: was importing _base from email_service which didn't exist as a
public export; switched to send_mention_email helper.
"""
import re
import uuid

# Single-token handles: @alice, @alice.smith, @alice@example.com typed by hand.
# This CANNOT match a display name containing a space, which is why the
# member-name pass below exists — see _resolve_mentions.
MENTION_RE = re.compile(r'@([\w.-]+)')


async def _resolve_mentions(pool, body: str, team_id):
    """
    Resolve @mentions to user rows.

    Two passes, because the picker and this parser disagreed about what a
    mention looks like:

    MentionTextarea inserts the member's FULL display name — `@{display_name} `
    (MentionTextarea.jsx) — and display_name is COALESCE(full_name, name, email),
    e.g. "Keval Shah". MENTION_RE stops at the space and captures only "Keval",
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

    # Pass 1 — team members, matched on their full display name.
    if team_id:
        members = await pool.fetch(
            """
            SELECT u.user_id, u.email, COALESCE(u.full_name, u.name, u.email) AS display
            FROM team_members tm
            JOIN users u ON u.user_id = tm.user_id
            WHERE tm.team_id = $1 AND tm.status = 'active'
            """,
            team_id,
        )
        lowered = body.lower()
        # Longest display name first: a member called "Keval" must not shadow
        # "Keval Shah" when both are on the team.
        for m in sorted(members, key=lambda r: len(r["display"] or ""), reverse=True):
            display = (m["display"] or "").strip()
            if not display:
                continue
            if f"@{display.lower()}" in lowered:
                found[m["user_id"]] = m

    # Pass 2 — single-token handles, as before.
    for handle in set(MENTION_RE.findall(body)):
        user = await pool.fetchrow(
            """
            SELECT user_id, email, COALESCE(full_name,name,email) AS display
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
    actor = await pool.fetchrow(
        "SELECT COALESCE(full_name,name,email) AS display FROM users WHERE user_id=$1", actor_id
    )
    actor_name = actor["display"] if actor else "Someone"

    for user in await _resolve_mentions(pool, body, task["team_id"] if task else None):
        if user["user_id"] == actor_id:
            continue

        mention_id = f"ment_{uuid.uuid4().hex[:12]}"
        try:
            await pool.execute(
                "INSERT INTO mentions (mention_id, comment_id, mentioned_user_id) VALUES ($1,$2,$3)",
                mention_id, comment_id, user["user_id"],
            )
        except Exception:
            pass

        await pool.execute(
            """
            INSERT INTO notifications (notification_id, user_id, type, title, message, task_id)
            VALUES ($1,$2,'mention',$3,$4,$5)
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
