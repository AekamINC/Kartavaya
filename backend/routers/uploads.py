"""
uploads.py — /api/upload endpoint backed by Cloudflare R2.

Per-file limit: 25 MB for video, 10 MB for everything else. `MAX_BYTES` and
`MAX_BYTES_VIDEO` below are the only statement of that; nothing repeats the
numbers in prose to a user, because this docstring said "50 MB for video, 5 MB
for everything else" while the constants read 50 and 25 — wrong on one of them
and stale on the other — and `server.py` told a rejected user "5 MB" while
enforcing 25. The message now comes from the limit itself.
"""
import logging
import mimetypes
import re
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query

logger = logging.getLogger(__name__)

from auth_router import require_user
from db import get_pool
from services.storage import upload_file, update_org_storage, check_storage_limit, read_capped

router = APIRouter(prefix="/api", tags=["uploads"])

MAX_BYTES        = 10 * 1024 * 1024   # 10 MB — any document or image
MAX_BYTES_VIDEO  = 25 * 1024 * 1024   # 25 MB — video

ALLOWED_TYPES = {
    # Images
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/heic", "image/heif",
    # SVG — owner's request 2026-08-08, "company logo SVG format should be
    # allowed". The upload screen has offered `image/svg+xml` in its `accept`
    # since it was written, so the picker showed .svg files and the server then
    # answered 415: a format advertised and refused. It is checked for active
    # content before it is stored — see `_svg_is_safe`.
    "image/svg+xml",
    # Video — any video/* MIME is accepted; common ones listed explicitly
    "video/quicktime", "video/mp4", "video/webm", "video/x-msvideo",
    "video/x-matroska", "video/3gpp", "video/3gpp2", "video/ogg",
    "video/mpeg", "video/x-flv", "video/x-ms-wmv", "video/x-ms-asf",
    "video/m4v",
    # Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    # Excel
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    # PowerPoint
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    # Text
    "text/plain",
}

# Magic-byte signatures for server-side type sniffing (offset, bytes)
_MAGIC: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff",             "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n",       "image/png"),
    (b"GIF87a",                   "image/gif"),
    (b"GIF89a",                   "image/gif"),
    (b"RIFF",                     "video/webm"),   # also WAV — ext disambiguates
    (b"\x1aE\xdf\xa3",           "video/webm"),
    (b"%PDF",                     "application/pdf"),
    (b"PK\x03\x04",              "application/zip"),  # .docx/.xlsx/.pptx are ZIP
    (b"\xd0\xcf\x11\xe0",        "application/msword"),  # legacy .doc/.xls/.ppt
    (b"ftyp",                     "video/mp4"),    # checked at offset 4
]

VIDEO_EXTENSIONS = {
    ".mov", ".mp4", ".webm", ".avi", ".mkv", ".m4v", ".3gp", ".3gpp",
    ".flv", ".wmv", ".asf", ".ogv", ".ts", ".mts", ".m2ts",
}

ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".svg",
    ".pdf",
    ".doc", ".docx",
    ".xls", ".xlsx", ".csv",
    ".ppt", ".pptx",
    ".txt",
} | VIDEO_EXTENSIONS


#: Constructs that make an SVG ACTIVE rather than a picture.
#:
#: An SVG is XML, not a bitmap: it can carry <script>, event handlers, and
#: references that fetch on open. In an <img> tag none of it executes, and
#: WeasyPrint runs the PDF with `base_url=None` so it cannot resolve anything
#: remote either — both of the paths this product actually renders logos on are
#: safe. What is NOT safe is somebody opening the signed storage URL directly,
#: where the browser treats it as a document and runs what is inside.
#:
#: A company logo needs none of these, so the honest trade is to refuse the file
#: rather than to sanitise it and hope the rewrite was complete.
_SVG_FORBIDDEN = (
    b"<script",
    b"javascript:",
    b"<foreignobject",     # arbitrary HTML inside the SVG
    b"<!entity",           # XXE — an entity that reads a local file
    b"<iframe",
    b"<embed",
    b"<object",
)


def _svg_is_safe(content: bytes) -> bool:
    """False when the SVG carries script, an external fetch, or an XML entity.

    Case-insensitive, and it checks for `on…=` handlers by pattern rather than
    by name: there are ~70 of them and a list would be missing whichever one
    somebody used.
    """
    lowered = content.lower()
    if any(bad in lowered for bad in _SVG_FORBIDDEN):
        return False
    # onload=, onclick=, onmouseover= … allowing for whitespace around the `=`.
    if re.search(rb"\son[a-z]+\s*=", lowered):
        return False
    return True


def _sniff_mime(header: bytes, ext: str, claimed: str) -> str:
    """Return a MIME type based on magic bytes, falling back to claimed value."""
    for magic, mime in _MAGIC:
        if header.startswith(magic):
            return mime
    # mp4 ftyp box is at byte 4
    if len(header) >= 8 and header[4:8] == b"ftyp":
        return "video/mp4"
    # HEIC/HEIF have no reliable magic — trust extension
    if ext in {".heic", ".heif"}:
        return f"image/{ext.lstrip('.')}"
    return claimed


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    team_id: Optional[str] = Query(None),
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    # Validate team membership before accepting the upload
    if team_id:
        # PROJECT membership, one table since migration 195 made
        # `project_assignments` a strict superset of active `team_members`.
        # Canonical note: `middleware/roles.may_reach_project`.
        member = await pool.fetchrow(
            "SELECT 1 FROM public.project_assignments "
            "WHERE team_id=$1 AND user_id=$2 LIMIT 1",
            team_id, user["user_id"]
        )
        from middleware.roles import is_platform_staff
        if not member and not await is_platform_staff(user["user_id"]):
            raise HTTPException(403, "Not a member of this project")

    fname = (file.filename or "upload").lower()
    ext   = "." + fname.rsplit(".", 1)[-1] if "." in fname else ""
    is_video = ext in VIDEO_EXTENSIONS
    limit    = MAX_BYTES_VIDEO if is_video else MAX_BYTES

    # This loop used to live here, and it was the only one of the four upload
    # paths that got it right. It is now `storage.read_capped`, so e-sign,
    # pahchan and the task-attachment endpoint share it instead of each reading
    # the whole body and checking afterwards.
    content = await read_capped(file, limit)   # label derived from `limit`, so it cannot drift
    total_size = len(content)

    claimed_mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    mime = _sniff_mime(content[:16], ext, claimed_mime)

    # Zip-based Office formats: trust extension to pick the right MIME
    if mime == "application/zip" and ext in (".docx", ".xlsx", ".pptx", ".odt", ".ods"):
        type_map = {
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }
        mime = type_map.get(ext, mime)

    # SVG has no magic bytes — it is text, and may begin with an XML
    # declaration, a comment, or the <svg> element itself. Sniffing 16 bytes
    # cannot tell, so the extension decides and the CONTENT is then checked.
    if ext == ".svg" and mime not in ("image/svg+xml",):
        mime = "image/svg+xml"

    if mime == "image/svg+xml" and not _svg_is_safe(content):
        raise HTTPException(
            415,
            "That SVG contains a script, an embedded object or an external "
            "reference, so it was not saved. Export the logo again as a plain "
            "SVG — or as a PNG, which cannot carry any of them.",
        )

    if mime not in ALLOWED_TYPES and not mime.startswith("video/") and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "File type not allowed. Supported: images, video, PDF, Word, Excel, PowerPoint.")

    if ext in VIDEO_EXTENSIONS and mime == "application/octet-stream":
        mime = "video/quicktime" if ext == ".mov" else f"video/{ext.lstrip('.')}"

    # `projects/{team_id}/{user_id}/YYYY/MM/…`, or `personal/{user_id}/…` when
    # there is no project. Both are the grammar (proposal 83 §4); the second
    # was already the shape `upload_file` fell back to, and it is now minted
    # rather than assembled from an f-string, so it gains the date partition and
    # keeps the original filename like everything else.
    #
    # `personal/` is the one module where the user segment appears once: there
    # the user IS what the file belongs to.

    org_id = None
    if team_id:
        org_row = await pool.fetchrow(
            "SELECT id FROM public.organisations "
            "WHERE team_id=$1 AND is_active=TRUE",
            team_id,
        )
        if org_row:
            org_id = str(org_row["id"])
            if not await check_storage_limit(org_id, total_size):
                raise HTTPException(
                    413,
                    "Organisation storage limit reached. Contact your administrator to upgrade.",
                )

    try:
        result = await upload_file(
            file_bytes=content,
            filename=file.filename or "upload",
            content_type=mime,
            user_id=user["user_id"],
            module="projects" if team_id else "personal",
            scope=[team_id] if team_id else [],
            org_id=org_id,
        )
    except Exception as exc:
        logger.exception(
            "R2 upload failed: ext=%s size=%d scope=%s",
            ext,
            total_size,
            "project" if team_id else "personal",
        )
        raise HTTPException(503, "Upload service temporarily unavailable — please try again in a moment.") from exc

    if org_id and result.get("key"):
        await update_org_storage(org_id, total_size)

    return result
