"""
uploads.py — /api/upload endpoint backed by Cloudflare R2.
Per-file limit: 50 MB for video, 5 MB for everything else.
"""
import logging
import mimetypes
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query

logger = logging.getLogger(__name__)

from auth_router import require_user
from db import get_pool
from services.storage import upload_file, update_org_storage, check_storage_limit

router = APIRouter(prefix="/api", tags=["uploads"])

MAX_BYTES        = 25 * 1024 * 1024   # 25 MB — images/docs
MAX_BYTES_VIDEO  = 50 * 1024 * 1024   # 50 MB — video

ALLOWED_TYPES = {
    # Images
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/heic", "image/heif",
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
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif",
    ".pdf",
    ".doc", ".docx",
    ".xls", ".xlsx", ".csv",
    ".ppt", ".pptx",
    ".txt",
} | VIDEO_EXTENSIONS


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
        member = await pool.fetchrow(
            "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2 "
            "UNION SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active' LIMIT 1",
            team_id, user["user_id"]
        )
        if not member and user.get("role") != "admin":
            raise HTTPException(403, "Not a member of this project")

    fname = (file.filename or "upload").lower()
    ext   = "." + fname.rsplit(".", 1)[-1] if "." in fname else ""
    is_video = ext in VIDEO_EXTENSIONS
    limit    = MAX_BYTES_VIDEO if is_video else MAX_BYTES

    chunks: list[bytes] = []
    total_size = 0
    chunk_size = 1024 * 1024
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total_size += len(chunk)
        if total_size > limit:
            label = "50 MB" if is_video else "25 MB"
            raise HTTPException(413, f"File exceeds {label} limit")
        chunks.append(chunk)
    content = b"".join(chunks)

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

    if mime not in ALLOWED_TYPES and not mime.startswith("video/") and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "File type not allowed. Supported: images, video, PDF, Word, Excel, PowerPoint.")

    if ext in VIDEO_EXTENSIONS and mime == "application/octet-stream":
        mime = "video/quicktime" if ext == ".mov" else f"video/{ext.lstrip('.')}"

    folder = f"projects/{team_id}" if team_id else None

    org_id = None
    if team_id:
        org_row = await pool.fetchrow(
            "SELECT id FROM staging.organisations "
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
            folder=folder,
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
