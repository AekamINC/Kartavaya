"""
messaging.py — Samvada · समवाद (Internal Messaging) Router
Channels, messages, threads, reactions, read state.
"""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/messaging", tags=["samvada-messaging"])

_gate = require_module("samvada")


async def _assert_channel_access(pool, channel_id, org_id: str, user_id: str) -> None:
    """Caller may read this channel: it is in their org, and they are a member
    of it or it is public.

    `list_messages` already enforced exactly this before returning message
    bodies. The thread and reaction endpoints checked only that the message was
    in the caller's org, so any org member could read the replies under a DM or
    a private channel — and react to them — by passing the message id. Same
    rule, one place, so the three cannot drift apart again.
    """
    ch = await pool.fetchrow(
        "SELECT type FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")
    if ch["type"] == "public":
        return
    mem = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user_id,
    )
    if not mem:
        raise HTTPException(403, "Not a member of this channel")


async def _assert_same_org(pool, target_user_id: str, org_id: str) -> None:
    """The user being added to a channel must belong to this org.

    Without this, `user_id` is an unvalidated caller-supplied identifier and a
    membership row could be written joining a channel in one org to a user in
    another. The org filter on every read meant that user could not actually
    read anything, so this was a cross-tenant WRITE rather than a leak — but it
    puts a foreign user in the member list and the member count, and it is the
    kind of row that becomes a leak the moment a query forgets its org filter.
    """
    ok = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid "
        "AND role_code IN ('org_owner','org_admin','org_member')",
        target_user_id, org_id,
    )
    if not ok:
        raise HTTPException(404, "User is not a member of this organisation")


# ── Pydantic Models ──────────────────────────────────────────

class ChannelCreate(BaseModel):
    name: str
    description: str = ""
    type: str = "public"

class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_archived: Optional[bool] = None

class MessageCreate(BaseModel):
    content: str
    type: str = "text"
    parent_message_id: Optional[str] = None

class MessageUpdate(BaseModel):
    content: str


# ── Channels ─────────────────────────────────────────────────

@router.get("/channels")
async def list_channels(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT c.*, (
            SELECT COUNT(*) FROM staging.samvada_channel_members cm2 WHERE cm2.channel_id = c.id
        ) AS member_count,
        (
            SELECT cm3.last_read_at FROM staging.samvada_channel_members cm3
            WHERE cm3.channel_id = c.id AND cm3.user_id = $2
        ) AS my_last_read,
        (
            SELECT COUNT(*) FROM staging.samvada_messages m
            WHERE m.channel_id = c.id AND m.is_deleted = FALSE
              AND m.parent_message_id IS NULL
              AND m.created_at > COALESCE(
                  (SELECT cm4.last_read_at FROM staging.samvada_channel_members cm4
                   WHERE cm4.channel_id = c.id AND cm4.user_id = $2), '1970-01-01'::timestamptz)
        ) AS unread_count
        FROM staging.samvada_channels c
        WHERE c.org_id = $1::uuid AND c.is_archived = FALSE
          AND (c.type = 'public' OR EXISTS (
              SELECT 1 FROM staging.samvada_channel_members cm
              WHERE cm.channel_id = c.id AND cm.user_id = $2))
        ORDER BY c.updated_at DESC
    """, org_id, user["user_id"])
    return [dict(r) for r in rows]


@router.post("/channels", status_code=201)
async def create_channel(
    body: ChannelCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    if body.type not in ("public", "private"):
        raise HTTPException(400, "Use /dm endpoint for DM channels")
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("""
                INSERT INTO staging.samvada_channels (org_id, name, description, type, created_by)
                VALUES ($1::uuid, $2, $3, $4, $5)
                RETURNING *
            """, org_id, body.name.strip(), body.description.strip(), body.type, user["user_id"])
            await conn.execute("""
                INSERT INTO staging.samvada_channel_members (channel_id, user_id, role)
                VALUES ($1, $2, 'admin')
            """, row["id"], user["user_id"])
    return dict(row)


@router.patch("/channels/{channel_id}")
async def update_channel(
    channel_id: str,
    body: ChannelUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    ch = await pool.fetchrow(
        "SELECT * FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")

    mem = await pool.fetchrow(
        "SELECT role FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user["user_id"],
    )
    if not mem or mem["role"] != "admin":
        raise HTTPException(403, "Only channel admins can edit")

    sets, vals, idx = [], [], 1
    for field in ("name", "description", "is_archived"):
        v = getattr(body, field, None)
        if v is not None:
            sets.append(f"{field}=${idx}")
            vals.append(v)
            idx += 1
    if not sets:
        return dict(ch)

    sets.append(f"updated_at=NOW()")
    vals.extend([channel_id, org_id])
    row = await pool.fetchrow(
        f"UPDATE staging.samvada_channels SET {', '.join(sets)} "
        f"WHERE id=${idx}::uuid AND org_id=${idx+1}::uuid RETURNING *",
        *vals,
    )
    return dict(row)


@router.post("/dm")
async def find_or_create_dm(
    target_user_id: str = Query(...),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await _assert_same_org(pool, target_user_id, org_id)
    existing = await pool.fetchrow("""
        SELECT c.* FROM staging.samvada_channels c
        WHERE c.org_id = $1::uuid AND c.type = 'dm'
          AND EXISTS (SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=c.id AND user_id=$2)
          AND EXISTS (SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=c.id AND user_id=$3)
          AND (SELECT COUNT(*) FROM staging.samvada_channel_members WHERE channel_id=c.id) = 2
    """, org_id, user["user_id"], target_user_id)
    if existing:
        return dict(existing)

    async with pool.acquire() as conn:
        async with conn.transaction():
            ch = await conn.fetchrow("""
                INSERT INTO staging.samvada_channels (org_id, name, type, created_by)
                VALUES ($1::uuid, '', 'dm', $2) RETURNING *
            """, org_id, user["user_id"])
            for uid in (user["user_id"], target_user_id):
                await conn.execute("""
                    INSERT INTO staging.samvada_channel_members (channel_id, user_id, role)
                    VALUES ($1, $2, 'member')
                """, ch["id"], uid)
    return dict(ch)


# ── Channel Members ──────────────────────────────────────────

@router.get("/channels/{channel_id}/members")
async def list_members(
    channel_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    ch = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")
    rows = await pool.fetch("""
        SELECT cm.*, u.full_name, u.email, u.avatar_url
        FROM staging.samvada_channel_members cm
        JOIN staging.users u ON u.user_id = cm.user_id
        WHERE cm.channel_id = $1::uuid
    """, channel_id)
    return [dict(r) for r in rows]


@router.post("/channels/{channel_id}/members", status_code=201)
async def add_member(
    channel_id: str,
    user_id: str = Query(...),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    ch = await pool.fetchrow(
        "SELECT type FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")
    if ch["type"] == "dm":
        raise HTTPException(400, "Cannot add members to DM channels")

    mem = await pool.fetchrow(
        "SELECT role FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user["user_id"],
    )
    if not mem:
        raise HTTPException(403, "Only channel members can add others")

    await _assert_same_org(pool, user_id, org_id)
    await pool.execute("""
        INSERT INTO staging.samvada_channel_members (channel_id, user_id)
        VALUES ($1::uuid, $2) ON CONFLICT DO NOTHING
    """, channel_id, user_id)
    return {"ok": True}


@router.delete("/channels/{channel_id}/members/{target_user_id}")
async def remove_member(
    channel_id: str,
    target_user_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    ch = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")

    if target_user_id != user["user_id"]:
        mem = await pool.fetchrow(
            "SELECT role FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
            channel_id, user["user_id"],
        )
        if not mem or mem["role"] != "admin":
            raise HTTPException(403, "Only channel admins can remove other members")

    await pool.execute("""
        DELETE FROM staging.samvada_channel_members
        WHERE channel_id=$1::uuid AND user_id=$2
    """, channel_id, target_user_id)
    return {"ok": True}


# ── Messages ─────────────────────────────────────────────────

@router.get("/channels/{channel_id}/messages")
async def list_messages(
    channel_id: str,
    before: Optional[str] = None,
    limit: int = Query(50, le=100),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # Verify membership
    mem = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user["user_id"],
    )
    ch = await pool.fetchrow(
        "SELECT type FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")
    if not mem and ch["type"] != "public":
        raise HTTPException(403, "Not a member of this channel")

    # `seen_by` is the read receipt `ScreensSanvaad.jsx` renders as the `.seen`
    # row ("Seen by Aanya, Rohan +1") and that no endpoint returned. It is
    # derived entirely from columns that already exist — `mark_read` below
    # stamps `samvada_channel_members.last_read_at`, so a member has seen a
    # message iff they have opened the channel since it was posted. No schema
    # change, no migration, and it costs one correlated sub-select on a query
    # that already runs two.
    #
    # The sender is excluded because "seen by yourself" is not a receipt, and
    # the list is capped at four names: the client renders two and a "+n", and
    # a 300-member channel would otherwise ship 300 names per message per poll.
    _SEEN = """
                   (SELECT COALESCE(json_agg(x.full_name), '[]') FROM (
                        SELECT u2.full_name
                        FROM staging.samvada_channel_members cm
                        JOIN staging.users u2 ON u2.user_id = cm.user_id
                        WHERE cm.channel_id = m.channel_id
                          AND cm.user_id <> m.sender_id
                          AND cm.last_read_at IS NOT NULL
                          AND cm.last_read_at >= m.created_at
                        ORDER BY cm.last_read_at LIMIT 4
                   ) x) AS seen_by,
                   (SELECT COUNT(*) FROM staging.samvada_channel_members cm2
                    WHERE cm2.channel_id = m.channel_id
                      AND cm2.user_id <> m.sender_id
                      AND cm2.last_read_at IS NOT NULL
                      AND cm2.last_read_at >= m.created_at) AS seen_count"""

    _COLS = """m.*, u.full_name AS sender_name, u.avatar_url AS sender_avatar,
                   (SELECT COUNT(*) FROM staging.samvada_messages t
                    WHERE t.parent_message_id = m.id AND t.is_deleted = FALSE) AS thread_count,
                   (SELECT MAX(t2.created_at) FROM staging.samvada_messages t2
                    WHERE t2.parent_message_id = m.id AND t2.is_deleted = FALSE) AS last_reply_at,
                   (SELECT COALESCE(json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id)), '[]')
                    FROM staging.samvada_message_reactions r WHERE r.message_id = m.id) AS reactions,""" + _SEEN

    if before:
        rows = await pool.fetch(f"""
            SELECT {_COLS}
            FROM staging.samvada_messages m
            JOIN staging.users u ON u.user_id = m.sender_id
            WHERE m.channel_id = $1::uuid AND m.is_deleted = FALSE
              AND m.parent_message_id IS NULL
              AND m.created_at < (SELECT created_at FROM staging.samvada_messages WHERE id=$3::uuid)
            ORDER BY m.created_at DESC LIMIT $2
        """, channel_id, limit, before)
    else:
        rows = await pool.fetch(f"""
            SELECT {_COLS}
            FROM staging.samvada_messages m
            JOIN staging.users u ON u.user_id = m.sender_id
            WHERE m.channel_id = $1::uuid AND m.is_deleted = FALSE
              AND m.parent_message_id IS NULL
            ORDER BY m.created_at DESC LIMIT $2
        """, channel_id, limit)
    return [dict(r) for r in rows]


@router.post("/channels/{channel_id}/messages", status_code=201)
async def send_message(
    channel_id: str,
    body: MessageCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    mem = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user["user_id"],
    )
    if not mem:
        ch = await pool.fetchrow(
            "SELECT type FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
            channel_id, org_id,
        )
        if not ch or ch["type"] != "public":
            raise HTTPException(403, "Not a member of this channel")
        await pool.execute("""
            INSERT INTO staging.samvada_channel_members (channel_id, user_id)
            VALUES ($1::uuid, $2)
        """, channel_id, user["user_id"])

    parent = body.parent_message_id
    row = await pool.fetchrow("""
        INSERT INTO staging.samvada_messages
            (org_id, channel_id, sender_id, content, type, parent_message_id)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
        RETURNING *
    """, org_id, channel_id, user["user_id"], body.content.strip(),
        body.type, parent)

    await pool.execute(
        "UPDATE staging.samvada_channels SET updated_at=NOW() WHERE id=$1::uuid",
        channel_id,
    )
    return dict(row)


@router.patch("/messages/{message_id}")
async def edit_message(
    message_id: str,
    body: MessageUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    msg = await pool.fetchrow(
        "SELECT sender_id FROM staging.samvada_messages WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg["sender_id"] != user["user_id"]:
        raise HTTPException(403, "Can only edit your own messages")

    row = await pool.fetchrow("""
        UPDATE staging.samvada_messages
        SET content=$1, is_edited=TRUE, updated_at=NOW()
        WHERE id=$2::uuid RETURNING *
    """, body.content.strip(), message_id)
    return dict(row)


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    msg = await pool.fetchrow(
        "SELECT sender_id FROM staging.samvada_messages WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg["sender_id"] != user["user_id"]:
        raise HTTPException(403, "Can only delete your own messages")

    await pool.execute("""
        UPDATE staging.samvada_messages SET is_deleted=TRUE, updated_at=NOW()
        WHERE id=$1::uuid
    """, message_id)
    return {"ok": True}


# ── Threads ──────────────────────────────────────────────────

@router.get("/messages/{message_id}/thread")
async def get_thread(
    message_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    parent = await pool.fetchrow(
        "SELECT channel_id FROM staging.samvada_messages WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not parent:
        raise HTTPException(404, "Message not found")
    await _assert_channel_access(pool, parent["channel_id"], org_id, user["user_id"])
    rows = await pool.fetch("""
        SELECT m.*, u.full_name AS sender_name, u.avatar_url AS sender_avatar
        FROM staging.samvada_messages m
        JOIN staging.users u ON u.user_id = m.sender_id
        WHERE m.parent_message_id = $1::uuid AND m.is_deleted = FALSE
        ORDER BY m.created_at ASC
    """, message_id)
    return [dict(r) for r in rows]


# ── Reactions ────────────────────────────────────────────────

@router.post("/messages/{message_id}/reactions")
async def add_reaction(
    message_id: str,
    emoji: str = Query(...),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    msg = await pool.fetchrow(
        "SELECT channel_id FROM staging.samvada_messages WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not msg:
        raise HTTPException(404, "Message not found")
    await _assert_channel_access(pool, msg["channel_id"], org_id, user["user_id"])
    await pool.execute("""
        INSERT INTO staging.samvada_message_reactions (message_id, user_id, emoji)
        VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING
    """, message_id, user["user_id"], emoji)
    return {"ok": True}


@router.delete("/messages/{message_id}/reactions/{emoji}")
async def remove_reaction(
    message_id: str,
    emoji: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    msg = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_messages WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not msg:
        raise HTTPException(404, "Message not found")
    await pool.execute("""
        DELETE FROM staging.samvada_message_reactions
        WHERE message_id=$1::uuid AND user_id=$2 AND emoji=$3
    """, message_id, user["user_id"], emoji)
    return {"ok": True}


# ── Read state ───────────────────────────────────────────────

@router.post("/channels/{channel_id}/read")
async def mark_read(
    channel_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute("""
        UPDATE staging.samvada_channel_members SET last_read_at=NOW()
        WHERE channel_id=$1::uuid AND user_id=$2
    """, channel_id, user["user_id"])
    return {"ok": True}


@router.get("/unread")
async def unread_counts(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT cm.channel_id,
               COUNT(m.id) AS unread
        FROM staging.samvada_channel_members cm
        JOIN staging.samvada_channels c ON c.id = cm.channel_id
        LEFT JOIN staging.samvada_messages m ON m.channel_id = cm.channel_id
          AND m.is_deleted = FALSE AND m.parent_message_id IS NULL
          AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01'::timestamptz)
          AND m.sender_id != $2
        WHERE c.org_id = $1::uuid AND cm.user_id = $2
        GROUP BY cm.channel_id
        HAVING COUNT(m.id) > 0
    """, org_id, user["user_id"])
    return {str(r["channel_id"]): r["unread"] for r in rows}
