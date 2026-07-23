"""
storage.py — Cloudflare R2 file storage (no auto-expiry).

Environment variables required:
  R2_ACCOUNT_ID        — Cloudflare account ID
  R2_ACCESS_KEY_ID     — R2 access key
  R2_SECRET_ACCESS_KEY — R2 secret key
  R2_BUCKET_NAME       — bucket name (e.g. 'Kartavaya-uploads')
  R2_PUBLIC_URL        — public URL prefix (e.g. https://uploads.Kartavaya.app)
                         OR leave empty to use presigned URLs (7-day expiry)
"""
import os
import uuid
from pathlib import Path
from typing import Optional
import logging

log = logging.getLogger(__name__)

# ── lazy import boto3 so the server still starts without it ───────────────────
_s3 = None

def _client():
    """Return a lazily-initialised boto3 S3 client pointed at the R2 endpoint, or None if unconfigured."""
    global _s3
    if _s3 is not None:
        return _s3
    try:
        import boto3
        from botocore.config import Config
        account_id      = os.environ.get("R2_ACCOUNT_ID", "")
        access_key      = os.environ.get("R2_ACCESS_KEY_ID", "")
        secret_key      = os.environ.get("R2_SECRET_ACCESS_KEY", "")
        if not account_id or not access_key or not secret_key:
            log.warning("R2 credentials not set — file uploads will fall back to base64")
            return None
        _s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(
                signature_version="s3v4",
                connect_timeout=10,
                read_timeout=120,
                retries={"max_attempts": 1},
            ),
            region_name="auto",
        )
        return _s3
    except Exception as exc:
        log.warning("R2 client init failed — file uploads will fall back to base64: %s", exc)
        return None


BUCKET   = os.environ.get("R2_BUCKET_NAME", "Kartavaya-uploads")
PUB_URL  = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")


async def upload_file(file_bytes: bytes, filename: str, content_type: str, user_id: str, folder: Optional[str] = None) -> dict:
    """
    Upload a file to R2. Returns {url, name, key, size}.
    Falls back to base64 data-URI when R2 is not configured.

    Key layout:
      projects/{team_id}/{uuid}{ext}  — project attachments, all files for that project together
      personal/{user_id}/{uuid}{ext}  — personal (non-project) attachments, one folder per user
    """
    client = _client()
    if client is None:
        # Fallback: base64 in-memory (no 60-day TTL, but won't crash dev)
        import base64
        b64 = base64.b64encode(file_bytes).decode()
        return {
            "url":  f"data:{content_type};base64,{b64}",
            "name": filename,
            "key":  None,
            "size": len(file_bytes),
        }

    import asyncio
    ext = Path(filename).suffix
    prefix = folder or f"personal/{user_id}"
    key = f"{prefix}/{uuid.uuid4().hex}{ext}"

    await asyncio.get_running_loop().run_in_executor(
        None,
        lambda: client.put_object(
            Bucket=BUCKET,
            Key=key,
            Body=file_bytes,
            ContentType=content_type,
        ),
    )

    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=7 * 24 * 3600,
    )

    return {"url": url, "name": filename, "key": key, "size": len(file_bytes)}


def refresh_url(key: str) -> Optional[str]:
    """Return a fresh signed URL for the given R2 key, or None if R2 is not configured."""
    if not key:
        return None
    client = _client()
    if client is None:
        if PUB_URL:
            return f"{PUB_URL}/{key}"
        return None
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=7 * 24 * 3600,
    )


async def delete_file(key: str) -> bool:
    """Delete a single object from R2 by key."""
    if not key:
        return False
    client = _client()
    if client is None:
        return False
    try:
        client.delete_object(Bucket=BUCKET, Key=key)
        return True
    except Exception as exc:
        log.warning("R2 delete failed for key=%s: %s", key, exc)
        return False
