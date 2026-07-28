"""
storage.py — Cloudflare R2 file storage with per-org account isolation.

Each org has its own Cloudflare account + R2 bucket.
Admin provides R2 credentials when creating an org.
Each org gets its own 10GB free tier from Cloudflare.

Credentials stored per-org in staging.organisations:
  r2_account_id, r2_access_key_id, r2_secret_access_key, r2_bucket_name

Local dev: set LOCAL_STORAGE_PATH to a directory path to store files on disk instead of R2.
Files are served via /local-files/ static route added in server.py.
"""
import asyncio
import os
import uuid
from pathlib import Path
from typing import Optional
import logging

from services.encryption import decrypt

log = logging.getLogger(__name__)

LOCAL_STORAGE_PATH = os.getenv("LOCAL_STORAGE_PATH")
_local_base_url = os.getenv("LOCAL_STORAGE_URL", "http://localhost:8080/local-files")

_org_clients: dict[str, object] = {}


def _build_client(account_id: str, access_key: str, secret_key: str):
    """Create a boto3 S3 client for a specific Cloudflare account."""
    import boto3
    from botocore.config import Config
    return boto3.client(
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


async def _get_org_r2(org_id: str) -> tuple[object, str] | tuple[None, None]:
    """Get the R2 client + bucket name for an org. Returns (client, bucket) or (None, None)."""
    if org_id in _org_clients:
        return _org_clients[org_id]

    from db import get_pool
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT r2_account_id, r2_access_key_id, r2_secret_access_key, r2_bucket_name "
        "FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    if not row or not row["r2_account_id"] or not row["r2_access_key_id"]:
        return None, None

    try:
        # `decrypt` passes unmarked values straight through, so rows written
        # before the column was encrypted keep working and no deploy ordering
        # is required between this and the backfill.
        client = _build_client(
            row["r2_account_id"],
            row["r2_access_key_id"],
            decrypt(row["r2_secret_access_key"]),
        )
        bucket = row["r2_bucket_name"] or f"kartavya-storage"
        _org_clients[org_id] = (client, bucket)
        return client, bucket
    except Exception as exc:
        log.error("Failed to build R2 client for org %s: %s", org_id, exc)
        _org_clients[org_id] = (None, None)
        return None, None


def clear_org_r2_cache(org_id: str = None):
    """Clear cached R2 clients. Call after credentials are updated."""
    if org_id:
        _org_clients.pop(org_id, None)
    else:
        _org_clients.clear()


async def create_org_bucket(org_id: str) -> str | None:
    """Create the R2 bucket for an org using their own credentials.
    Returns bucket name or None if R2 not configured."""
    client, bucket = await _get_org_r2(org_id)
    if client is None:
        log.warning("R2 not configured for org %s — skipping bucket creation", org_id)
        return None

    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: client.create_bucket(Bucket=bucket),
        )
        log.info("Created R2 bucket: %s for org %s", bucket, org_id)
    except Exception as exc:
        if "BucketAlreadyOwnedByYou" in str(exc) or "BucketAlreadyExists" in str(exc):
            pass
        else:
            log.error("Failed to create R2 bucket %s for org %s: %s", bucket, org_id, exc)

    return bucket


async def verify_r2_credentials(account_id: str, access_key: str, secret_key: str) -> dict:
    """Test R2 credentials by listing buckets. Returns {valid, buckets, error}."""
    try:
        client = _build_client(account_id, access_key, secret_key)
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, client.list_buckets)
        bucket_names = [b["Name"] for b in result.get("Buckets", [])]
        return {"valid": True, "buckets": bucket_names, "error": None}
    except Exception as exc:
        return {"valid": False, "buckets": [], "error": str(exc)}


async def upload_file(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    user_id: str,
    folder: Optional[str] = None,
    org_id: Optional[str] = None,
) -> dict:
    """
    Upload a file to the org's dedicated R2 bucket.
    Falls back to local filesystem when LOCAL_STORAGE_PATH is set.
    Falls back to base64 data-URI when neither R2 nor local storage is configured.
    """
    ext = Path(filename).suffix
    prefix = folder or f"personal/{user_id}"
    key = f"{prefix}/{uuid.uuid4().hex}{ext}"

    if LOCAL_STORAGE_PATH:
        dest = Path(LOCAL_STORAGE_PATH) / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(file_bytes)
        url = f"{_local_base_url}/{key}"
        return {"url": url, "name": filename, "key": key, "size": len(file_bytes), "bucket": "local"}

    client, bucket = None, None
    if org_id:
        client, bucket = await _get_org_r2(org_id)

    if client is None:
        import base64
        b64 = base64.b64encode(file_bytes).decode()
        return {
            "url": f"data:{content_type};base64,{b64}",
            "name": filename,
            "key": None,
            "size": len(file_bytes),
            "bucket": None,
        }

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        None,
        lambda: client.put_object(
            Bucket=bucket,
            Key=key,
            Body=file_bytes,
            ContentType=content_type,
        ),
    )

    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=32400,
    )

    return {"url": url, "name": filename, "key": key, "size": len(file_bytes), "bucket": bucket}


async def sign_key(org_id: str, key: str) -> Optional[str]:
    """Generate a fresh presigned URL for an R2 key. Returns None if R2 not configured."""
    if not key or not org_id:
        return None
    if LOCAL_STORAGE_PATH:
        return f"{_local_base_url}/{key}"
    client, bucket = await _get_org_r2(org_id)
    if not client:
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=32400,
        )
    except Exception as e:
        log.warning("Failed to sign key %s for org %s: %s", key, org_id, e)
        return None


async def refresh_signed_url(org_id: str, old_url: str) -> str:
    """Re-sign an R2 URL by extracting the key from the stored pre-signed URL.
    DEPRECATED: use sign_key() with a stored file_key instead."""
    if not old_url or old_url.startswith("data:"):
        return old_url
    try:
        from urllib.parse import urlparse
        parsed = urlparse(old_url)
        full_key = parsed.path.lstrip("/")
        client, bucket = await _get_org_r2(org_id)
        if not client:
            return old_url
        if full_key.startswith(bucket + "/"):
            full_key = full_key[len(bucket) + 1:]
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": full_key},
            ExpiresIn=32400,
        )
    except Exception as e:
        log.warning("Failed to refresh signed URL for org %s: %s", org_id, e)
        return old_url


async def update_org_storage(org_id: str, size_delta: int):
    """Update an org's storage_used_bytes. Positive = upload, negative = delete."""
    try:
        from db import get_pool
        pool = await get_pool()
        await pool.execute(
            "UPDATE staging.organisations "
            "SET storage_used_bytes = GREATEST(0, storage_used_bytes + $1) "
            "WHERE id=$2::uuid",
            size_delta, org_id,
        )
    except Exception as exc:
        log.warning("Failed to update org storage for %s: %s", org_id, exc)


async def check_storage_limit(org_id: str, file_size: int) -> bool:
    """Return True if the org has enough storage quota for file_size bytes."""
    try:
        from db import get_pool
        pool = await get_pool()
        row = await pool.fetchrow(
            "SELECT storage_used_bytes, storage_limit_bytes "
            "FROM staging.organisations WHERE id=$1::uuid",
            org_id,
        )
        if not row or row["storage_limit_bytes"] <= 0:
            return True
        return (row["storage_used_bytes"] + file_size) <= row["storage_limit_bytes"]
    except Exception:
        return True


async def delete_file(key: str, org_id: Optional[str] = None) -> bool:
    """Delete a single object from R2 by key."""
    if not key:
        return False
    if LOCAL_STORAGE_PATH:
        target = Path(LOCAL_STORAGE_PATH) / key
        if target.exists():
            target.unlink()
            return True
        return False
    client, bucket = None, None
    if org_id:
        client, bucket = await _get_org_r2(org_id)
    if client is None:
        return False
    try:
        client.delete_object(Bucket=bucket, Key=key)
        return True
    except Exception as exc:
        log.warning("R2 delete failed for bucket=%s key=%s: %s", bucket, key, exc)
        return False
