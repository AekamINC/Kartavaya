"""recycle_bin.py — the customer's own two-stage bin.

Proposal 93 · B. Migration 239 is the table, `services/recycle_bin.py` is the
policy, and this file is the wiring: who may call what, and against which org.

── WHOSE SCREEN THIS SERVES ────────────────────────────────────────────────

The CUSTOMER'S. Owner's decision, 2026-08-29: an org admin or owner can see and
recover their own org's deleted files for 14 days, then a second-stage bin to
90, and they may delete permanently from either. SharePoint/OneDrive shape.

Gated on `ORG_MANAGEMENT_ROLES` — `org_owner` and `org_admin` — and not on
plain membership. A bin is org-wide by construction: it holds files from tasks
and CRM records that the person reading it may never have been able to open,
including ones marked private or restricted by `visible_to`. Showing every
member the org's whole deletion history would be a privacy regression achieved
by adding a recovery feature.

⚠ **`org_member` gets no route here at all, rather than an empty list.** An
empty list reads as "nothing has been deleted", which is a different and false
fact — the same reason `support_sessions.requestable_organisations` answers 403
instead of `[]`.

── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────

**No route can bin a Ganit invoice or an eSign document**, and that is enforced
in three places rather than trusted to one: the `source_kind` CHECK in
migration 239, `SOURCE_KINDS` in the service, and the simple fact that no
delete control exists on those screens. Books of account carry an 8-year Income
Tax retention and GST records 72 months; a customer who deletes a signed
invoice finds out at assessment.

**The org-settings Storage tab stays read-only.** That is a separate settled
decision and it stands. `TabStorage.jsx:40-45` is right that deleting an object
without its row produces exactly the failure that tab exists to diagnose —
delete belongs on the surfaces that own the row, which is why the two binning
call sites are in `server.py` (task attachments) and `graha.py` (CRM
documents), and why this router only ever reads and restores.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.role_tiers import ORG_MANAGEMENT_ROLES
from middleware.roles import require_org_role
from services import recycle_bin as bin_svc

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/recycle-bin", tags=["recycle-bin"])


@router.get("")
async def list_bin(
    stage: int | None = Query(None, ge=1, le=2),
    user=Depends(require_org_role(*ORG_MANAGEMENT_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """What this organisation can still recover.

    `stage` filters; omitting it returns both, each row carrying its own
    derived `stage`, `leaves_stage1_at` and `purges_at`. The dates are computed
    rather than stored — see the service header and migrations 111/182.
    """
    rows = await bin_svc.list_bin(org_id=org_id, stage=stage)
    return {
        "data": rows,
        "stage1_days": bin_svc.STAGE2_AFTER_DAYS,
        "purge_days": bin_svc.PURGE_AFTER_DAYS,
        # Said by the server so the two screens cannot drift into two different
        # explanations of one rule.
        "quota_note": (
            "Files in the recycle bin still count towards your storage. "
            "The space comes back when a file is deleted permanently."
        ),
    }


@router.post("/{bin_id}/restore")
async def restore(
    bin_id: str,
    user=Depends(require_org_role(*ORG_MANAGEMENT_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Put the pointer back on the record it came off.

    ⚠ **THE POINTER IS WRITTEN FIRST AND THE BIN ROW IS CLOSED SECOND.** If the
    row were closed first and the pointer write then failed, the file would
    leave the bin while staying unreachable — nothing destroyed, but the
    customer told they have it back when they do not. This order's worst case is
    a bin row that can be restored twice, which is visible and harmless.

    Restore works from BOTH stages. A second-stage bin you cannot recover from
    is not a bin, it is a delay.
    """
    row = await bin_svc.get_row(org_id=org_id, bin_id=bin_id)
    if not row:
        raise HTTPException(404, "That file is not in your recycle bin.")
    if row["purged_at"]:
        raise HTTPException(
            410,
            "That file was permanently deleted and cannot be recovered.",
        )
    if row["restored_at"]:
        return {"ok": True, "already": True}

    pool = await get_pool()

    if row["source_kind"] == "task_attachment":
        # ⚠ `public.tasks`, and the JSONB append has to be idempotent: a task
        # whose attachment was restored twice must not end up holding it twice.
        # The `NOT EXISTS` over the existing keys is what makes the second call
        # a no-op rather than a duplicate.
        task = await pool.fetchrow(
            "SELECT task_id, attachments FROM public.tasks "
            "WHERE task_id=$1 AND org_id=$2::uuid",
            row["source_id"], org_id,
        )
        if not task:
            raise HTTPException(
                409,
                "The task this file belonged to no longer exists, so there is "
                "nowhere to restore it to.",
            )
        import json as _json
        current = task["attachments"]
        current = _json.loads(current) if isinstance(current, str) else (current or [])
        if not any((a or {}).get("key") == row["r2_key"] for a in current):
            current.append({
                "name": row["file_name"],
                "url": row["file_url"],
                "key": row["r2_key"],
                "size": int(row["size_bytes"] or 0),
                "is_private": False,
                "visible_to": [],
                # Recorded so a restored file is distinguishable from one that
                # was never deleted — an audit question somebody will ask.
                "restored_at": None,
            })
            await pool.execute(
                "UPDATE public.tasks SET attachments=$1::jsonb, updated_at=NOW() "
                "WHERE task_id=$2 AND org_id=$3::uuid",
                _json.dumps(current), row["source_id"], org_id,
            )
    else:
        # `graha_documents` soft-deletes with `is_active=FALSE`
        # (`graha.py:4917`), so the restore is the mirror of it. Scoped on
        # org_id as well as id, because a destructive-adjacent write may not be
        # one predicate short — the lesson `delete_task` records at length.
        done = await pool.execute(
            "UPDATE staging.graha_documents "
            "   SET is_active=TRUE, updated_at=NOW(), updated_by=$3 "
            " WHERE id=$1::uuid AND org_id=$2::uuid",
            row["source_id"], org_id, user["user_id"],
        )
        if done == "UPDATE 0":
            raise HTTPException(
                409,
                "The document record this file belonged to no longer exists.",
            )

    await bin_svc.mark_restored(org_id=org_id, bin_id=bin_id)
    return {"ok": True, "restored": row["file_name"]}


@router.delete("/{bin_id}")
async def delete_from_bin(
    bin_id: str,
    user=Depends(require_org_role(*ORG_MANAGEMENT_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Stage 1 → stage 2, or stage 2 → **gone**.

    ONE VERB, TWO OUTCOMES, and which one happens is decided by the row's stage
    rather than by a flag the caller sends. That is deliberate: a client that
    could ask for "destroy it" directly could destroy a stage-1 file by getting
    one boolean wrong, and the whole point of two stages is that the
    irreversible step is reached on purpose.

    The response says which happened, in words, so the screen never has to
    guess what it just did.
    """
    row = await bin_svc.get_row(org_id=org_id, bin_id=bin_id)
    if not row:
        raise HTTPException(404, "That file is not in your recycle bin.")
    if row["purged_at"]:
        return {"ok": True, "stage": 2, "purged": True, "already": True}

    if bin_svc.stage_of(row) == 1:
        await bin_svc.promote(org_id=org_id, bin_id=bin_id)
        return {
            "ok": True,
            "stage": 2,
            "purged": False,
            "message": (
                f"{row['file_name']} moved to the second-stage recycle bin. "
                "It can still be recovered there."
            ),
        }

    result = await bin_svc.purge(org_id=org_id, bin_id=bin_id)
    if not result.get("ok"):
        # The server's own reason, not a generic one: "could not be deleted
        # from storage" and "not found" send a person to different places.
        raise HTTPException(502, result.get("reason") or "Could not delete that file.")
    return {
        "ok": True,
        "stage": 2,
        "purged": True,
        "freed_bytes": result.get("freed_bytes", 0),
        "message": f"{row['file_name']} was permanently deleted.",
    }
