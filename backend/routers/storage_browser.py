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

A LISTING has the same problem, and it is not theoretical: the folder names in
the two in-scope orgs' buckets today are `personal/user_…`,
`pahchan/{employee uuid}` and `projects/team_…`, so the first screen an
administrator sees would be a page of ids. `_folder_labels` resolves them to
what they name, and `browse` returns `label` plus `is_id` so a client knows the
segment itself may not be drawn. `resolve` does the same to the whole path, in
`parsed.display` — which is the only spelling of a key a screen may render,
because `parsed.relative` still carries every id the grammar puts inside it.

── AND THE ONE THING A RESOLVE MUST NOT DO, WHICH IT DID ───────────────────

Answer "nothing at this key" about a key that is right there. Every key stored
in this database predates the grammar and is stored WITHOUT the tenant root —
137 of them, 0 in the grammar, measured 2026-08-26. The first version prepended
the root to anything that did not already carry it and looked up only the
result, so a key copied out of `sign_documents.file_key` was rewritten into one
that matched nothing. Both spellings are tried now; the tenancy predicate is
unchanged, so what is LOOKED UP widened and what can be SEEN did not.

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
import re
from typing import Optional, Sequence

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


# ── FOLDER NAMES ARE IDS, AND IDS ARE NOT ALLOWED ON A SCREEN ───────────────
#
# The module docstring above settles the KEY as a technical field beside a
# human label. A LISTING has the same problem one level down and it is not
# theoretical — it is what the two in-scope orgs' buckets actually contain,
# read on 2026-08-26:
#
#     org/64e7bea6…/personal/user_…              5 objects
#     org/64e7bea6…/pahchan/{employee uuid}/     1 object
#     kartavya-storage/personal/user_…           5 objects
#     kartavya-storage/pahchan/{employee uuid}/  1 object
#     kartavya-storage/projects/team_…           2 objects
#
# So the first screen a customer sees would draw a member's user id and an
# employee's uuid as folder names, which is the one rule this product does not
# bend (`check-rendered-ids.mjs`). Filtering them out instead would leave a file
# browser that cannot reach 95 of the 95 objects that exist.
#
# The answer is the one the module already commits to: resolve the id to the
# NAME OF THE THING, server-side, and hand the screen `label` plus `is_id`. The
# id stays in `prefix` — where it is an address the client echoes back, never
# text — and a folder whose id resolves to nothing renders as its kind alone
# ("A member's own files"), never as the raw segment.

#: A folder segment that is an id, by shape. Both live shapes are here: a bare
#: uuid (`manav_employees.id`) and this product's prefixed text ids
#: (`user_f1a0…`, `team_ea27…`), which `users.user_id` and `teams.team_id` are.
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_TEXT_ID = re.compile(r"^(?:user|team|org|doc|emp|client|proj)_[0-9a-zA-Z]{6,}$")


def _is_id(name: str) -> bool:
    return bool(_UUID.fullmatch(name or "") or _TEXT_ID.fullmatch(name or ""))


#: id → name, one source per kind of thing a folder can be. Every one carries
#: `org_id` IN THE PREDICATE for the same reason `_KEY_COLUMNS` does: a label
#: lookup must not be able to confirm another org's record exists. `id` and the
#: name column are server-side constants here, never a caller string.
_UUID_SOURCES = (
    ("public.sign_documents", "title", "eSign document"),
    ("public.graha_clients", "name", "Client"),
    ("public.manav_employees", "name", "Employee"),
    ("public.projects", "name", "Project"),
)

#: The top-level folder, said in words. `MODULES` is the machine list; this is
#: what an org administrator reading the tab is actually looking at.
_MODULE_TITLES = {
    "esign": "Signed documents",
    "projects": "Project files",
    "crm": "Client documents",
    "srijan": "Marketing images",
    "personal": "Personal uploads",
    "pahchan": "Attendance photographs",
    "procurement": "Procurement files",
}

#: What a folder whose id resolves to NOTHING is called. A deleted employee,
#: a member who left, a client removed last year — the object is still there
#: and still counts against the allowance, so the row must render. It renders
#: as what it is, and never as the id.
_ORPHAN_KINDS = {
    "personal": "A member's own files",
    "pahchan": "One employee's photographs",
    "projects": "One team's files",
    "crm": "One client's documents",
    "esign": "One document's files",
}


async def _folder_labels(org_id: str, names: Sequence[str]) -> dict:
    """`{segment: {"label": …, "kind": …}}` for every segment that is an id.

    By VALUE, not by position, and that is deliberate: the grammar puts the
    client id at depth 2 and the employee id at depth 3, but NO live key is in
    the grammar yet (0 of 95 objects, 0 of 137 stored keys, measured
    2026-08-26). The legacy shapes put the same ids at different depths —
    `pahchan/{employee}/…` against the grammar's `pahchan/{kind}/{employee}/…` —
    so a depth map would label the new keys and none of the ones that exist.
    Looking the segment up wherever it appears labels both.
    """
    ids = [n for n in dict.fromkeys(names) if _is_id(n)]
    if not ids:
        return {}

    uuids = [n for n in ids if _UUID.fullmatch(n)]
    texts = [n for n in ids if n not in uuids]
    pool = await get_pool()
    out: dict = {}

    for table, name_col, kind in _UUID_SOURCES:
        if not uuids:
            break
        try:
            rows = await pool.fetch(
                f"SELECT id::text AS ref, {name_col} AS label FROM {table} "
                f"WHERE org_id = $1::uuid AND id = ANY($2::uuid[])",
                org_id, uuids,
            )
        except Exception as exc:                                  # noqa: BLE001
            # A label is an improvement on a listing, never a precondition for
            # one. A browser that 500s because one lookup table moved is worse
            # than a browser that says "One employee's photographs".
            log.warning("storage label lookup failed on %s: %s", table, exc)
            continue
        for row in rows:
            out.setdefault(row["ref"], {"label": row["label"], "kind": kind})

    if texts:
        try:
            rows = await pool.fetch(
                # `public.users` carries no org_id — membership is
                # `staging.user_roles`, the sole tenant path — so the join IS
                # the scope here, not a filter applied afterwards.
                "SELECT u.user_id AS ref, COALESCE(u.name, u.full_name) AS label "
                "FROM public.users u "
                "JOIN public.user_roles r ON r.user_id = u.user_id "
                "WHERE r.org_id = $1::uuid AND u.user_id = ANY($2::text[])",
                org_id, texts,
            )
            for row in rows:
                out.setdefault(row["ref"], {"label": row["label"], "kind": "Member"})
            rows = await pool.fetch(
                "SELECT team_id AS ref, name AS label FROM public.teams "
                "WHERE org_id = $1::uuid AND team_id = ANY($2::text[])",
                org_id, texts,
            )
            for row in rows:
                out.setdefault(row["ref"], {"label": row["label"], "kind": "Team"})
        except Exception as exc:                                  # noqa: BLE001
            log.warning("storage label lookup failed on the text ids: %s", exc)

    return out


def _describe_folder(name: str, prefix: str, labels: dict) -> dict:
    """One folder row: what it is called, what kind of thing it is, and whether
    its own name may be drawn."""
    depth_top = (prefix or f"{name}/").split("/", 1)[0]
    hit = labels.get(name)
    if hit:
        return {"label": hit["label"] or hit["kind"], "kind": hit["kind"], "is_id": True}
    if _is_id(name):
        return {"label": None, "kind": _ORPHAN_KINDS.get(depth_top, "Files"), "is_id": True}
    if not prefix:
        # The top level is the module list, said in words.
        return {"label": _MODULE_TITLES.get(name, name), "kind": None, "is_id": False}
    return {"label": name.replace("-", " ").replace("_", " "), "kind": None, "is_id": False}


def _display_path(rel: str, labels: dict) -> str:
    """The key as a SENTENCE — the only spelling of it a screen may draw.

    `relative` has the tenant root off it, which is enough for the org id. It is
    NOT enough for the rest: the grammar puts a member's user id and an
    employee's uuid INSIDE the path (`personal/{user_id}/2026/08/…`), so a
    screen rendering `relative` would draw an id the moment the first key in the
    grammar is written — which is to say, on the next upload after this ships.

    Every id segment is replaced by what it names, and a date pair is folded
    into one readable month. Nothing here is reversible into an id, and nothing
    here is used as an address: the address is `key`, which the client echoes
    back and never renders.
    """
    parts = [p for p in (rel or "").split("/") if p]
    if not parts:
        return ""
    top = parts[0]
    out: list[str] = [_MODULE_TITLES.get(top, top.replace("-", " ").replace("_", " "))]
    i = 1
    while i < len(parts):
        seg = parts[i]
        # …/YYYY/MM/… — one readable month rather than two folders.
        if (i + 1 < len(parts) and len(seg) == 4 and seg.isdigit()
                and len(parts[i + 1]) == 2 and parts[i + 1].isdigit()):
            out.append(f"{seg}-{parts[i + 1]}")
            i += 2
            continue
        if _is_id(seg):
            hit = labels.get(seg)
            out.append(hit["label"] or hit["kind"] if hit
                       else _ORPHAN_KINDS.get(top, "Unnamed"))
        elif i == len(parts) - 1:
            # The filename. The half after `--` is what a person called it.
            out.append(seg.split("--", 1)[-1] if "--" in seg else seg)
        else:
            out.append(seg.replace("-", " ").replace("_", " "))
        i += 1
    return " / ".join(out)


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
        "FROM public.organisations WHERE id=$1::uuid",
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
        # WHERE THAT FIGURE COMES FROM, said once, on the server, because both
        # clients would otherwise word it differently or not at all.
        #
        # `storage_used_bytes` is a RUNNING TOTAL kept by `update_org_storage`,
        # and only two upload paths call it — `routers/uploads.py:248` and
        # `server.py:4993`. eSign, Pahchan, Srijan and the scraper results all
        # write objects and increment nothing. Measured 2026-08-27:
        #
        #     Unicode Group          bucket 89 objects / 89,591,092 bytes
        #                            counter                   20,182 bytes
        #     E2E Test & Associates  bucket  6 objects /    146,897 bytes
        #                            counter                        0 bytes
        #
        # A recount is a sweep over the whole bucket, which is exactly what
        # `browse` uses a delimiter to avoid doing on a page load, so it belongs
        # in a job and is recorded as owed. What must NOT happen meanwhile is a
        # screen quietly presenting the running total as a measurement — a
        # meter reading 0% over 85 MB of files is a confident wrong answer.
        "used_note": (
            "Counted as files are uploaded through the paths that report their "
            "size. Documents written by e-sign, attendance, marketing and the "
            "scrapers are not added to this figure yet, so the real total is "
            "higher."
        ),
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
    # One lookup for the whole page rather than one per row: a folder listing is
    # up to `limit` segments and this must not become `limit` round trips.
    labels = await _folder_labels(org_id, [f["name"] for f in folders])
    for folder in folders:
        folder.update(_describe_folder(folder["name"], prefix, labels))

    files = []
    for obj in (page.get("Contents") or []):
        key = obj["Key"]
        if key == full_prefix:            # the prefix itself, if it is an object
            continue
        name = key.rsplit("/", 1)[-1]
        files.append({
            "name": name,
            # Relative, like `folders`. The full key is available from
            # `resolve`, which is where a copyable machine address belongs.
            "key": key[len(root):],
            # The half after `--` is what the person who uploaded it called the
            # file; a legacy key is a bare id and has no such half, so the row
            # says so instead of drawing the id.
            "label": name.split("--", 1)[-1] if "--" in name else (None if _is_id(name.rsplit(".", 1)[0]) else name),
            "is_id": _is_id(name.rsplit(".", 1)[0]),
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
    ("public.pahchan_punches", "photo_key", "Attendance photograph"),
    ("public.sign_documents", "file_key", "eSign document"),
    ("public.sign_documents", "signed_file_key", "eSign document, executed"),
    ("public.sign_documents", "certificate_file_key", "eSign completion certificate"),
    ("public.graha_documents", "file_key", "CRM document"),
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

    # TWO CANDIDATES, NOT ONE — and this is the difference between a support
    # tool that works today and one that works after a backfill nobody has run.
    #
    # The original single-candidate version prepended the root to anything that
    # did not already carry it, then looked the RESULT up. Every key stored in
    # this database predates the grammar and is stored WITHOUT the root:
    # `staging/esign/…`, `contracts/…`, a bare filename — 137 of them across
    # `sign_documents` and `graha_documents`, 0 in the grammar (2026-08-26). So
    # a key pasted out of the column it lives in became
    # `org/{org}/staging/esign/…`, matched no row, found no object, and the tab
    # answered "nothing at this key, and no record names it" — the one answer
    # that must never be wrong, about the only keys that exist.
    #
    # Both spellings are tried, and every record lookup still carries `org_id`
    # in the predicate, so widening what is LOOKED UP does not widen what can
    # be SEEN.
    candidates = [key]
    if root and not key.startswith(root):
        # A key copied from a browse listing is relative; add the root back.
        # A key that names a DIFFERENT org's prefix does not get that
        # treatment — it is refused below.
        if key.startswith("org/"):
            raise HTTPException(
                403,
                "That key belongs to another organisation's storage.",
            )
        candidates.append(f"{root}{key}")
    if not root and key.startswith("org/") and not key.startswith(f"org/{org_id}/"):
        # An org on its OWN Cloudflare account still has legacy objects on the
        # platform bucket under its own `org/{id}/` prefix — `_client_for_key`
        # routes them there deliberately, so that an org which brought its own
        # account later keeps reading what it stored before. Refusing its own
        # prefix made those unresolvable; only somebody ELSE's is refused.
        raise HTTPException(
            403, "That key belongs to another organisation's storage.",
        )

    pool = await get_pool()
    record, matched = None, None
    for candidate in candidates:
        for table, column, label in _KEY_COLUMNS:
            # Every one of these tables carries `org_id`, and it is in the
            # predicate rather than checked afterwards: a resolve must not be
            # able to confirm that another org's key exists, even by answering
            # more slowly.
            row = await pool.fetchrow(
                f"SELECT * FROM {table} WHERE {column} = $1 AND org_id = $2::uuid LIMIT 1",
                candidate, org_id,
            )
            if row:
                record = {"kind": label, "table": table.split(".")[-1]}
                for name_col in ("title", "name", "document_name"):
                    if name_col in row.keys() and row[name_col]:
                        record["label"] = row[name_col]
                        break
                matched = candidate
                break
        if record:
            break

    # Ask the bucket about the spelling the ROW used first, if a row was found:
    # that is the key the product would sign, so it is the one whose presence
    # answers "can this document be opened".
    order = ([matched] if matched else []) + [c for c in candidates if c != matched]
    present, size = None, None
    loop = asyncio.get_running_loop()
    for candidate in order:
        client, bucket = await storage._client_for_key(org_id, candidate)
        if client is None:
            continue
        try:
            head = await loop.run_in_executor(
                None,
                lambda c=client, b=bucket, k=candidate: c.head_object(Bucket=b, Key=k),
            )
            present, size, matched = True, head.get("ContentLength"), candidate
            break
        except Exception:
            present = False

    key = matched or candidates[-1]
    # `parsed.relative` is the ONLY spelling of this key a screen may draw, so
    # the tenant prefix has to come off even when it is not this org's root.
    # An org on its own account can hold a legacy `org/{its own id}/…` key (see
    # the refusal above), and `root` is "" for that org — so passing `root`
    # alone would hand the UI a string with an organisation uuid in it.
    display_root = root or (f"org/{org_id}/" if key.startswith(f"org/{org_id}/") else "")
    parsed = _parse_key(key, display_root)
    parsed["display"] = _display_path(
        parsed["relative"],
        await _folder_labels(org_id, parsed["relative"].split("/")),
    )
    return {
        "key": key,
        "parsed": parsed,
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
