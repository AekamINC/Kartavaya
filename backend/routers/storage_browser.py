"""
storage_browser.py — the Storage tab. Proposal 83 §5.

The ask, in the owner's words: **make a file findable without a developer.**

That was not possible before, and the reason was not the absence of a screen.
There were four different key grammars (§3), so a key could not be read without
knowing which caller wrote it, and "everything for this client" or "everything
this person uploaded" were not questions the bucket could answer at all. §4
settled the grammar (`services/storage_keys.py`); this is what §5 says falls out
of it — "once keys are predictable, the browser is just the key, rendered".

── WHAT THIS IS AND IS NOT ──────────────────────────────────────────────────

It is a READ surface plus one resolver:

    GET  /api/v1/org/storage              where this org's files live, and how
                                          much room is left
    GET  /api/v1/org/storage/browse       one level of the prefix tree
    POST /api/v1/org/storage/resolve      paste a key from a log or a ticket
                                          and be told what it is

There is NO delete here, and that is deliberate rather than unfinished. A file
in this product is a POINTER held in a column — `sign_documents.file_key`,
`graha_documents.file_key`, `pahchan_punches.photo_key` — and deleting the
object without the row produces exactly the failure this tab exists to
diagnose: a record naming a file the bucket does not have. Deletion belongs to
the module that owns the row, and to the retention sweep the date partition
finally makes possible.

── THE NAMES-NOT-IDS RULE, WHICH THIS LOOKS LIKE IT BREAKS ─────────────────

The standing rule is that a user, member or org id is never rendered in the UI,
and an object key contains ids by nature. §5 settles it and this module holds to
it: **the key is a machine address, not a way of naming a person.** So every
response here leads with the human label — the document's title, the person's
name — and carries the key as a technical field beside it, the way a support
tool shows a request id. `resolve` exists precisely so that a key pasted from a
log becomes a sentence about a document and a person.

── AND THE ONE THING A BROWSER MUST NOT BECOME ─────────────────────────────

A way to read another org's files. Every path here resolves its bucket through
`storage._client_for_key`, which routes on the key's own prefix, and every
listing is bounded to the caller's own tenant root — see `_tenant_root`. A key
that resolves outside it is refused before any client is built, not filtered out
of the results afterwards.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from services import storage
from services.storage_keys import MODULES

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/org/storage", tags=["org-storage"])

#: Storage is org administration: it shows what the organisation is paying for
#: and where its files are. `ORG_SETTINGS_ROLES` is the same gate the rest of
#: org settings uses.
_gate = require_org_role("org_admin", "org_owner")

#: One page of a prefix listing. Deliberately modest: this is a browser, and a
#: thousand rows in one response is a screen nobody can read and a payload that
#: makes the tab feel broken on a phone.
_PAGE = 200
_PAGE_MAX = 1000


async def _tenant_root(org_id: str) -> str:
    """The prefix everything belonging to this org lives under.

    Two answers, and which one applies is a fact about the org rather than
    about the key:

        own Cloudflare account   ""                  the BUCKET is the tenant
        platform bucket          "org/{org_id}/"     the PREFIX is the tenant

    This is the same split `_resolve_r2` applies on the way in, read back on
    the way out. It is also the whole tenancy guard of this module: a listing is
    rooted here and a resolve is refused outside it.
    """
    client, _bucket = await storage._get_org_r2(org_id)
    return "" if client is not None else f"org/{org_id}/"


def _human_bytes(n: Optional[int]) -> str:
    size = float(n or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


@router.get("")
async def storage_overview(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Where this org's files live, and how much room is left.

    The header of §5's sketch: whether the org is on its own Cloudflare account
    or the vendor's, which bucket, how much of the allowance is used, and when
    something was last written.

    NO CREDENTIAL IS RETURNED. Not the access key id, not the account id, not a
    masked version of either. `staging.organisations` holds them encrypted and
    this endpoint has no reason to read them — "does the org have its own
    account" is a boolean, and the boolean is the only part of it a screen
    needs.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT name, r2_bucket_name, storage_used_bytes, storage_limit_bytes, "
        "       (r2_account_id IS NOT NULL) AS own_account "
        "FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    if not row:
        raise HTTPException(404, "Organisation not found")

    used = int(row["storage_used_bytes"] or 0)
    limit = int(row["storage_limit_bytes"] or 0)
    return {
        "org": row["name"],
        "own_account": bool(row["own_account"]),
        # The vendor's bucket name is not a customer's business, and the
        # customer's own is on their Cloudflare dashboard anyway.
        "bucket": row["r2_bucket_name"] if row["own_account"] else None,
        "used_bytes": used,
        "limit_bytes": limit,
        "used_label": _human_bytes(used),
        "limit_label": _human_bytes(limit) if limit else None,
        # `None` rather than 0 when there is no limit: a progress bar at 0% and
        # a progress bar that does not apply are different screens.
        "used_pct": round(used * 100 / limit, 1) if limit else None,
        "modules": list(MODULES),
    }


@router.get("/browse")
async def browse(
    prefix: str = Query("", max_length=1024),
    limit: int = Query(_PAGE, ge=1, le=_PAGE_MAX),
    cursor: str = Query("", max_length=4096),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """One level of the tree, folders first.

    `prefix` is relative to the org's own root and never includes it — a caller
    cannot walk upwards by sending `org/<somebody-else>/`, because the root is
    prepended here and `..` is not a thing in an S3 key.

    Uses `Delimiter="/"`, so this is one round trip per level rather than a
    listing of everything under it. That matters at Pahchan scale: 1,659 punch
    photographs today, hundreds of thousands with one real customer, and a
    prefix listing without a delimiter would try to read all of them.
    """
    prefix = (prefix or "").lstrip("/")
    if ".." in prefix:
        raise HTTPException(400, "A storage prefix cannot contain '..'")

    root = await _tenant_root(org_id)
    full_prefix = f"{root}{prefix}"

    client, bucket = await storage._client_for_key(org_id, full_prefix or root)
    if client is None:
        # An org with no storage configured at all. Not an error — an empty
        # tab that says so is the right screen, and 503 here would read as an
        # outage.
        return {"prefix": prefix, "folders": [], "files": [], "configured": False,
                "next_cursor": None}

    kwargs = {"Bucket": bucket, "Prefix": full_prefix, "Delimiter": "/",
              "MaxKeys": limit}
    if cursor:
        kwargs["ContinuationToken"] = cursor

    loop = asyncio.get_running_loop()
    try:
        page = await loop.run_in_executor(
            None, lambda: client.list_objects_v2(**kwargs),
        )
    except Exception as exc:
        log.warning("storage browse failed for org %s at %r: %s", org_id, prefix, exc)
        raise HTTPException(502, "The storage bucket could not be listed just now.")

    folders = [
        {"name": (cp["Prefix"][len(full_prefix):]).rstrip("/"),
         "prefix": cp["Prefix"][len(root):]}
        for cp in (page.get("CommonPrefixes") or [])
    ]
    files = []
    for obj in (page.get("Contents") or []):
        key = obj["Key"]
        if key == full_prefix:            # the prefix itself, if it is an object
            continue
        files.append({
            "name": key.rsplit("/", 1)[-1],
            # Relative, like `folders`. The full key is available from
            # `resolve`, which is where a copyable machine address belongs.
            "key": key[len(root):],
            "size_bytes": obj.get("Size"),
            "size_label": _human_bytes(obj.get("Size")),
            "last_modified": obj.get("LastModified"),
        })

    return {
        "prefix": prefix,
        "configured": True,
        "folders": folders,
        "files": files,
        "next_cursor": page.get("NextContinuationToken"),
        "truncated": bool(page.get("IsTruncated")),
    }


class ResolveBody(BaseModel):
    #: Anything from a log, a ticket or a database column. Accepted with or
    #: without the tenant prefix, because a key copied out of
    #: `sign_documents.file_key` has it and one copied out of a browse listing
    #: does not.
    key: str = Field(..., min_length=1, max_length=1024)


#: Which column in which table holds a key, and how to say what it is. Ordered
#: by how likely a pasted key is to be one of them, which is also roughly how
#: often each is written.
_KEY_COLUMNS = (
    ("staging.pahchan_punches", "photo_key", "Attendance photograph"),
    ("staging.sign_documents", "file_key", "eSign document"),
    ("staging.sign_documents", "signed_file_key", "eSign document, executed"),
    ("staging.sign_documents", "certificate_file_key", "eSign completion certificate"),
    ("staging.graha_documents", "file_key", "CRM document"),
)


@router.post("/resolve")
async def resolve_key(
    body: ResolveBody,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Paste a key; be told what it is, whose it is, and whether it is there.

    §5's second half, and the one that makes this a support tool rather than a
    file browser. It answers three separate questions, and keeping them separate
    is the point:

      · WHAT THE ROW SAYS  — which record names this key, and its human label.
      · WHAT THE BUCKET SAYS — is the object actually present, and how big.
      · WHAT THE KEY SAYS  — the grammar, parsed: module, what it belongs to,
                              who did it, when.

    A key that resolves to a row and NOT to an object is the bug report already
    written: "this record points at a file the bucket does not have". Five
    executed e-sign PDFs were in exactly that state once, and finding them took
    a developer and a database session.
    """
    key = body.key.strip()
    # Tolerate a whole presigned URL — it is what somebody copies out of a
    # browser, and the key is the path inside it.
    if key.startswith("http://") or key.startswith("https://"):
        from urllib.parse import unquote, urlparse

        key = unquote(urlparse(key).path).lstrip("/")
        # The bucket is the first path segment on an R2 endpoint URL.
        if "/" in key:
            key = key.split("/", 1)[1]

    root = await _tenant_root(org_id)
    if root and not key.startswith(root):
        # A key copied from a browse listing is relative; add the root back.
        # A key that names a DIFFERENT org's prefix does not get that
        # treatment — it is refused below.
        if key.startswith("org/"):
            raise HTTPException(
                403,
                "That key belongs to another organisation's storage.",
            )
        key = f"{root}{key}"
    if not root and key.startswith("org/"):
        raise HTTPException(
            403, "That key belongs to another organisation's storage.",
        )

    pool = await get_pool()
    record = None
    for table, column, label in _KEY_COLUMNS:
        # Every one of these tables carries `org_id`, and it is in the predicate
        # rather than checked afterwards: a resolve must not be able to confirm
        # that another org's key exists, even by answering more slowly.
        row = await pool.fetchrow(
            f"SELECT * FROM {table} WHERE {column} = $1 AND org_id = $2::uuid LIMIT 1",
            key, org_id,
        )
        if row:
            record = {"kind": label, "table": table.split(".")[-1]}
            for name_col in ("title", "name", "document_name"):
                if name_col in row.keys() and row[name_col]:
                    record["label"] = row[name_col]
                    break
            break

    present, size = None, None
    client, bucket = await storage._client_for_key(org_id, key)
    if client is not None:
        loop = asyncio.get_running_loop()
        try:
            head = await loop.run_in_executor(
                None, lambda: client.head_object(Bucket=bucket, Key=key),
            )
            present, size = True, head.get("ContentLength")
        except Exception:
            present = False

    return {
        "key": key,
        "parsed": _parse_key(key, root),
        "record": record,
        "object_present": present,
        "size_bytes": size,
        "size_label": _human_bytes(size) if size is not None else None,
        # The sentence the tab leads with, assembled here so the two clients
        # cannot word it differently.
        "summary": _summarise(record, present),
    }


def _parse_key(key: str, root: str) -> dict:
    """The grammar, read back off a key. Best effort, and says so.

    Old keys pre-date the grammar and will not parse cleanly — that is expected
    and is not an error. `matches_grammar` is what tells the screen whether to
    show the parsed breakdown or just the raw key.
    """
    rel = key[len(root):] if root and key.startswith(root) else key
    parts = rel.split("/")
    out = {"relative": rel, "matches_grammar": False, "module": parts[0] if parts else None}
    if len(parts) < 4 or parts[0] not in MODULES:
        return out
    # …/YYYY/MM/file — the date is the two segments before the filename.
    year, month = parts[-3], parts[-2]
    if not (year.isdigit() and len(year) == 4 and month.isdigit() and len(month) == 2):
        return out
    out.update({
        "matches_grammar": True,
        "scope": parts[1:-3],
        "year": year,
        "month": month,
        "filename": parts[-1],
        # The half after `--` is the original name; the half before is the
        # time-sortable id.
        "original_name": parts[-1].split("--", 1)[-1] if "--" in parts[-1] else None,
    })
    return out


def _summarise(record: Optional[dict], present: Optional[bool]) -> str:
    if record and present:
        return f"{record['kind']}: {record.get('label') or 'unnamed'} — object present."
    if record and present is False:
        return (
            f"{record['kind']}: {record.get('label') or 'unnamed'} — but the "
            "object is NOT in the bucket. This record points at a file the "
            "storage does not have."
        )
    if record:
        return f"{record['kind']}: {record.get('label') or 'unnamed'}."
    if present:
        return "An object is present at this key, but no record in this organisation names it."
    if present is False:
        return "Nothing at this key, and no record in this organisation names it."
    return "Storage is not configured for this organisation, so the key could not be checked."
