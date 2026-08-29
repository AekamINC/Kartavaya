"""The two-stage recycle bin — SharePoint/OneDrive shape, owner-approved.

Proposal 93 · B. Migration 239 is the table; this is the only module that
writes it, so the two stages and the quota rule are stated once here rather
than spelled out at every call site.

── WHAT THIS EXISTS TO STOP ────────────────────────────────────────────────

Before it, there was **no delete anywhere in this product that kept the file**,
and the one "remove" that existed destroyed the pointer and kept the object:

  · `TaskDrawer.jsx:621` filtered the attachments array and saved the task
    through `PUT /tasks/{id}`. ⚠ **This was the only path the web ever used.**
  · `server.py:5438` `DELETE /tasks/{id}/attachments/{key}` did the same
    server-side — and its ONLY caller in the whole product is mobile
    (`mobile/src/api/tasks.ts:143`).

Either way the R2 object stayed in the bucket, billed forever, with the key
gone from the row — so it was unreachable by anyone, **including Aekam**. No
confirmation, no undo, no record that it ever happened.

⚠ **THAT SECOND BULLET IS WHY BINNING ONLY THE DELETE ROUTE WOULD HAVE BEEN A
FALSE FIX.** It is the obvious place to put the bin, it is the route named
"delete an attachment", and it would have captured mobile deletions while
missing every deletion a customer makes in a browser — with the feature
reporting itself built. `TaskDrawer` now calls the same route, so there is one
door.

── A CORRECTION TO THE RECORD THIS MODULE INHERITED ─────────────────────────

`docs/STATUS.md` and `93-NEXT-SESSION.md` both say `delete_file` has **zero
callers**. Measured 2026-08-29: that is **wrong**. `services/pahchan_retention.py:90`
calls it, behind an armed daily cron, and `storage.py:838-844` documents a
production incident from that very call site. The true statement is narrower —
the storage *browser* has no delete (`tests/test_storage_browser.py:177` asserts
exactly that and nothing wider), and nothing had ever wired a delete for a
customer-facing file. Recorded here because a claim repeated from a doc is how
the last four false accusations in this programme started.

── THE TWO STAGES ──────────────────────────────────────────────────────────

    stage 1   days 0-14    Restore, or Delete (-> stage 2). Destroys nothing.
    stage 2   days 14-90   Restore STILL WORKS. Delete permanently -> the R2
                           object is destroyed now.
    day 90                 the sweeper purges what is left.

Both stages are visible to `org_owner`/`org_admin` and to nobody else. The
routes enforce that; this module assumes it has already been enforced and
scopes every statement on `org_id` regardless, because a service that trusts
its caller for tenancy is one refactor from a cross-tenant read.

⚠ **THE STAGE IS DERIVED AND NEVER STORED.** `STAGE2_AFTER` below is the age
floor and `stage2_at` is the early promotion; the read takes whichever came
first. Migration 111 refuses a `status` column and 182 refuses a `closed_at`
for the reason this inherits — a stored answer is a cache of an event, and its
failure mode is staleness. Here that failure mode is a screen telling a
customer their file is recoverable when the sweeper has already been past it.

⚠ **BINNED FILES COUNT AGAINST THE QUOTA.** `update_org_storage` is called
from `purge()` and from NOWHERE ELSE in this module. The owner's decision, and
the reason survives restating: an org that could delete its way back under its
limit would sit permanently over it, and every "you are out of space" message
would be answerable with "empty your bin", which is not a thing this product
would then be able to honour.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Iterable, Optional

from db import get_pool
from services.storage import delete_file, update_org_storage

log = logging.getLogger(__name__)

#: Days 0-14 are stage 1; after this the item is in the second-stage bin.
STAGE2_AFTER_DAYS = 14

#: The R2 object is destroyed at 90 days, measured from `deleted_at` and NOT
#: from `stage2_at`. A customer who clears stage 1 on day 2 does not thereby
#: shorten the recovery floor Aekam holds — the owner's "hard-deleted at 90" is
#: a property of when the file was deleted, not of when somebody tidied up.
PURGE_AFTER_DAYS = 90

#: The only two sources delete is wired to. The database CHECK is the real
#: guard; this is the readable half.
#:
#: ⚠ GANIT INVOICES AND ESIGN DOCUMENTS ARE ABSENT AND MUST STAY ABSENT.
#: Books of account carry an 8-year Income Tax retention and GST records 72
#: months. A customer who deletes a signed invoice finds out at assessment,
#: which is far too late for an undo to help.
SOURCE_KINDS = ("task_attachment", "graha_document")

_SELECT = """
    SELECT id, org_id, source_kind, source_id, file_name, r2_key, file_url,
           size_bytes, deleted_by, deleted_at, stage2_at, restored_at,
           purged_at, purge_error
      FROM staging.deleted_files
"""

#: The same name ladder `services/audit_actors` uses, and the same LEFT join.
#:
#: LEFT and never INNER: a file deleted by somebody who has since left the
#: organisation must still appear in the bin. An inner join would make rows
#: VANISH when a person is removed — data loss that looks like a filter working.
#:
#: `public.users` is schema-qualified. Migration 142 exists because a query that
#: relied on `search_path` found a shadow table in the other schema.
_LIST_SELECT = """
    SELECT d.id, d.org_id, d.source_kind, d.source_id, d.file_name, d.r2_key,
           d.file_url, d.size_bytes, d.deleted_at, d.stage2_at, d.restored_at,
           d.purged_at, d.purge_error,
           COALESCE(NULLIF(btrim(_du.name), ''), NULLIF(btrim(_du.full_name), ''))
             AS deleted_by_name
      FROM staging.deleted_files d
      LEFT JOIN public.users _du ON _du.user_id = d.deleted_by
"""


def stage_of(row: Any, *, now=None) -> int:
    """1 or 2. Derived, every time, from the two facts that can promote a row.

    Not a column. See the module header, and 111/182 for the precedent.
    """
    if row.get("stage2_at") if isinstance(row, dict) else row["stage2_at"]:
        return 2
    deleted_at = row["deleted_at"] if not isinstance(row, dict) else row.get("deleted_at")
    if deleted_at is None:
        return 1
    from datetime import datetime, timezone
    ref = now or datetime.now(timezone.utc)
    return 2 if (ref - deleted_at) >= timedelta(days=STAGE2_AFTER_DAYS) else 1


async def bin_file(
    *,
    org_id: str,
    source_kind: str,
    source_id: str,
    file_name: str,
    r2_key: str,
    file_url: Optional[str],
    size_bytes: int,
    deleted_by: str,
) -> Optional[dict]:
    """Record one deleted file. **Destroys nothing.**

    Returns the bin row, or None when there is no key to keep — an attachment
    with no `key` is a legacy pointer at something this product can no longer
    address, and inventing a row for it would put an un-restorable entry in a
    customer's bin. The caller still removes the pointer; there is simply
    nothing to recover.
    """
    if not r2_key:
        log.info(
            "recycle_bin: %s %s has no r2 key, nothing to keep", source_kind, source_id
        )
        return None
    if source_kind not in SOURCE_KINDS:
        # Belt and braces with the database CHECK. A caller passing a new
        # string must be a deliberate migration, not a typo that lands rows the
        # bin screens cannot render.
        raise ValueError(f"recycle_bin: {source_kind!r} is not a binnable source")

    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO staging.deleted_files
              (org_id, source_kind, source_id, file_name, r2_key, file_url,
               size_bytes, deleted_by)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::bigint, $8)
        RETURNING *
        """,
        org_id, source_kind, source_id, file_name or "file", r2_key,
        file_url, int(size_bytes or 0), deleted_by,
    )
    # ⚠ NO `update_org_storage` HERE. Binned files count against quota; the
    # decrement happens in `purge()` and nowhere else.
    return dict(row) if row else None


async def bin_many(items: Iterable[dict], *, org_id: str, deleted_by: str) -> int:
    """Bin a whole task's attachments at once. Returns how many were kept.

    ⚠ THIS IS WHY `DELETE /api/tasks/{id}` NEEDED TOUCHING AT ALL. Deleting a
    task hard-deletes the row, and its `attachments` JSONB goes with it — so
    every object it pointed at orphaned wholesale, in one statement, with no
    record. Binning the attachments first is the difference between a delete
    and a disappearance.
    """
    kept = 0
    for a in items or []:
        got = await bin_file(
            org_id=org_id,
            source_kind="task_attachment",
            source_id=str(a.get("_task_id") or ""),
            file_name=a.get("name") or "file",
            r2_key=a.get("key") or "",
            file_url=a.get("url"),
            size_bytes=a.get("size") or 0,
            deleted_by=deleted_by,
        )
        if got:
            kept += 1
    return kept


async def list_bin(*, org_id: str, stage: Optional[int] = None) -> list[dict]:
    """What this org can still recover, newest first.

    A purged or restored row is never listed: "we destroyed it" and "you got it
    back" are both answers, and neither belongs in a bin.

    ⚠ **`deleted_by` IS NOT IN THE PAYLOAD. `deleted_by_name` IS.**

    The first draft returned the raw `users.user_id` and let the screen resolve
    it against `GET /v1/org/members`. That was wrong twice over. It misses
    anybody who has since left the organisation and every platform account — so
    the commonest reason to open a bin, "who deleted this and when did they
    leave", is the case it cannot answer. And it puts a user id in the browser
    at all, where the names-not-IDs ratchet
    (`frontend/scripts/check-rendered-ids.mjs`) cannot see it: the ratchet is
    positional and reads what a component draws, so an id passed through a
    helper is invisible to it. Proved during review — mutating the screen to
    render the id turned the unit tests red and left `npm run check` GREEN.

    Resolving it here means no id is ever sent, so the rule is enforced at the
    API boundary instead of by a component remembering to be careful. This is
    what `/teams/bin` already does for the project bin (`deleted_by_name`,
    drawn at `ProjectsPage.jsx:343`).
    """
    pool = await get_pool()
    rows = await pool.fetch(
        _LIST_SELECT + """
         WHERE d.org_id = $1::uuid
           AND d.purged_at IS NULL
           AND d.restored_at IS NULL
         ORDER BY d.deleted_at DESC
        """,
        org_id,
    )
    out = []
    for r in rows:
        d = dict(r)
        d["stage"] = stage_of(r)
        # The date the customer actually needs, and it differs by stage: in
        # stage 1 the useful question is when it leaves, in stage 2 it is when
        # it is destroyed.
        d["leaves_stage1_at"] = d["deleted_at"] + timedelta(days=STAGE2_AFTER_DAYS)
        d["purges_at"] = d["deleted_at"] + timedelta(days=PURGE_AFTER_DAYS)
        # A person who is gone from `public.users` entirely leaves the ladder
        # with nothing. Say so in words rather than falling back to the id —
        # falling back is exactly what puts a UUID on screen, and it does it
        # only in the rare case nobody tests.
        if not d.get("deleted_by_name"):
            d["deleted_by_name"] = "No longer on file"
        out.append(d)
    return [d for d in out if stage is None or d["stage"] == stage]


async def get_row(*, org_id: str, bin_id: str) -> Optional[dict]:
    """One bin row, scoped to the org. Never fetched by id alone."""
    pool = await get_pool()
    row = await pool.fetchrow(
        _SELECT + " WHERE id = $1::uuid AND org_id = $2::uuid", bin_id, org_id
    )
    return dict(row) if row else None


async def promote(*, org_id: str, bin_id: str) -> Optional[dict]:
    """Stage 1 -> stage 2, because a person cleared it out early.

    Destroys nothing. This is the SharePoint behaviour the owner asked for:
    deleting from the first-stage bin moves the item to the second, it does not
    empty it into nowhere.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE staging.deleted_files
           SET stage2_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid
           AND purged_at IS NULL AND restored_at IS NULL
           AND stage2_at IS NULL
        RETURNING *
        """,
        bin_id, org_id,
    )
    return dict(row) if row else None


async def mark_restored(*, org_id: str, bin_id: str) -> Optional[dict]:
    """Close the bin row because its pointer has been put back.

    ⚠ THE CALLER RESTORES THE POINTER, and it does so BEFORE calling this. If
    this ran first and the pointer write then failed, the row would leave the
    bin while the file stayed unreachable — the object is still in R2, so
    nothing is destroyed, but the customer is told they have it back and they
    do not. Marking last means the worst case is a bin row that can be restored
    twice, which is visible and harmless.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE staging.deleted_files
           SET restored_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid
           AND purged_at IS NULL AND restored_at IS NULL
        RETURNING *
        """,
        bin_id, org_id,
    )
    return dict(row) if row else None


async def purge(*, org_id: Optional[str], bin_id: str) -> dict:
    """**Destroy the R2 object.** The only irreversible act in this feature.

    `org_id` is Optional ONLY so the sweeper can run across tenants; every
    customer-facing caller passes it and the statement is scoped on it when it
    is present.

    ── THE ORDER IS THE OBJECT FIRST, THEN THE ROW, AND IT MATTERS ──────────
    If the row were marked purged first and the R2 delete then failed, the
    object would be billed forever with the last pointer to it gone — which is
    the exact orphan this whole feature exists to stop, reintroduced at the
    final step. Failing the other way leaves a bin row whose object is already
    gone; a restore then fails loudly and a human can see why.

    `delete_file` returns False rather than raising, and it is careful about
    which bucket a key belongs to — an org with its own R2 had a platform key
    deleted against its bucket once, where S3 answers 204 for an object that
    was never there, so a True return meant nothing. The `purge_error` column
    records a False so it is a row somebody can find, not a log line.
    """
    row = await get_row(org_id=org_id, bin_id=bin_id) if org_id else None
    if org_id and not row:
        return {"ok": False, "reason": "not found"}
    if row and row.get("purged_at"):
        return {"ok": True, "already": True}

    pool = await get_pool()
    if row is None:
        row = dict(await pool.fetchrow(_SELECT + " WHERE id = $1::uuid", bin_id) or {})
        if not row:
            return {"ok": False, "reason": "not found"}

    ok = await delete_file(row["r2_key"], str(row["org_id"]))
    if not ok:
        await pool.execute(
            "UPDATE staging.deleted_files SET purge_error=$2 WHERE id=$1::uuid",
            bin_id, "R2 delete returned False",
        )
        return {"ok": False, "reason": "the object could not be deleted from storage"}

    await pool.execute(
        "UPDATE staging.deleted_files SET purged_at=now(), purge_error=NULL "
        "WHERE id=$1::uuid",
        bin_id,
    )
    # ⚠ THE ONLY PLACE THE QUOTA MOVES. Binned files count against the org at
    # both stages; the space comes back when the bytes actually go.
    await update_org_storage(str(row["org_id"]), -int(row["size_bytes"] or 0))
    return {"ok": True, "freed_bytes": int(row["size_bytes"] or 0)}


async def due_for_purge(*, limit: int = 500) -> list[dict]:
    """Everything past the 90-day floor, across all orgs. The sweeper's scan.

    Measured from `deleted_at`, never from `stage2_at` — see PURGE_AFTER_DAYS.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        _SELECT + """
         WHERE purged_at IS NULL
           AND restored_at IS NULL
           AND deleted_at < now() - ($1::int * interval '1 day')
         ORDER BY deleted_at ASC
         LIMIT $2::int
        """,
        PURGE_AFTER_DAYS, limit,
    )
    return [dict(r) for r in rows]
