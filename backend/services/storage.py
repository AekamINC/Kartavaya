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

# ── The platform bucket ──────────────────────────────────────────────────────
#
# Per-org R2 is the design and stays the primary path: each org brings its own
# Cloudflare account and its own 10GB free tier. But an org WITHOUT credentials
# used to fall through to a base64 data-URI written into the database row, and
# that is how 32MB of files — one of them a 14MB mp4 — ended up inside
# `public.tasks`, six rows accounting for 45% of the entire database. Aekam Inc
# was one of the orgs with no credentials, so the vendor's own uploads did it
# too, silently, reporting success.
#
# These four variables have been set on Railway all along and were read in
# exactly one place: a startup log line. They are the fallback that should
# always have existed.
#
# Keys written here are prefixed `org/<org_id>/` — NOT because the bucket needs
# the namespace (a uuid4 would do) but because the prefix makes a key
# self-describing. `sign_key` can then tell from the key alone which bucket
# holds the object, so an org that adds its own credentials LATER keeps working:
# its old files stay signable against the platform bucket instead of 404ing
# against a new empty one. It also makes the eventual migration a copy of one
# prefix.
_PLATFORM_PREFIX = "org/"
_platform_cache: list = []


def _platform_r2() -> tuple[object, str] | tuple[None, None]:
    """The vendor's own R2 bucket, from the environment. (None, None) if unset."""
    if _platform_cache:
        return _platform_cache[0]

    account = os.getenv("R2_ACCOUNT_ID")
    access = os.getenv("R2_ACCESS_KEY_ID")
    secret = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket = os.getenv("R2_BUCKET_NAME")
    if not (account and access and secret and bucket):
        _platform_cache.append((None, None))
        return _platform_cache[0]

    try:
        _platform_cache.append((_build_client(account, access, secret), bucket))
    except Exception as exc:  # a malformed credential must not take the upload with it
        log.warning("Platform R2 is configured but the client would not build: %s", exc)
        _platform_cache.append((None, None))
    return _platform_cache[0]


async def _resolve_r2(org_id: Optional[str]) -> tuple[object, str, str]:
    """
    Where this org's files go: its own bucket, else the platform bucket.

    Returns (client, bucket, key_prefix). (None, None, "") means neither is
    configured, which on a deployed server should not happen and is logged
    loudly by the one caller that can still fall back.
    """
    if org_id:
        client, bucket = await _get_org_r2(org_id)
        if client is not None:
            return client, bucket, ""

    client, bucket = _platform_r2()
    if client is not None:
        # An upload with no org at all still needs somewhere to live; `shared/`
        # keeps it out of any org's prefix rather than inventing an org id.
        return client, bucket, f"{_PLATFORM_PREFIX}{org_id}/" if org_id else "shared/"

    return None, None, ""


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

    client, bucket, key_prefix = await _resolve_r2(org_id)
    if client is not None:
        key = f"{key_prefix}{key}"

    if client is None:
        # LAST RESORT, and on a deployed server it means the platform R2
        # variables are missing — because `_resolve_r2` has already tried the
        # org's own bucket AND the vendor's. Before the platform fallback
        # existed this branch was reached by every org without credentials and
        # wrote the file into the database row. Loud, because the symptom
        # otherwise is a database that grows by megabytes per upload while
        # every screen reports success.
        log.warning(
            "NO R2 for org %s and no platform bucket — writing %s (%d bytes) as a "
            "data URI into the database row. Set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / "
            "R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME.",
            org_id, filename, len(file_bytes),
        )
        import base64
        b64 = base64.b64encode(file_bytes).decode()
        return {
            "url": f"data:{content_type};base64,{b64}",
            "name": filename,
            # An empty string, NOT None. There is genuinely no object key here —
            # the bytes are in the URL — but `None` is a different kind of
            # nothing, and it escaped into SQL: `sign_documents.file_key` is NOT
            # NULL, and `upload_result.get("key", "")` returns None rather than
            # the default because the key IS present and holds None. Every e-sign
            # PDF upload therefore 500'd for any org without R2 credentials,
            # which was two of the three orgs on staging — and since e-sign needs
            # a PDF, the whole module was unusable for them.
            #
            # "" is falsy exactly as None was, so `if result.get("key")` guards
            # (pahchan, uploads) keep behaving identically.
            "key": "",
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
    """
    Generate a fresh presigned URL for an R2 key. None if R2 is not configured.

    The KEY decides the bucket, not the org's current configuration. A key
    beginning `org/` or `shared/` was written to the platform bucket, and it
    stays there — so an org that adds its own credentials after some files were
    already stored keeps reading them, instead of having every one of them
    signed against a new, empty bucket and 404.
    """
    if not key or not org_id:
        return None
    if LOCAL_STORAGE_PATH:
        return f"{_local_base_url}/{key}"

    if key.startswith(_PLATFORM_PREFIX) or key.startswith("shared/"):
        client, bucket = _platform_r2()
    else:
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


async def download_file(key: str, org_id: Optional[str] = None,
                        url: Optional[str] = None) -> Optional[bytes]:
    """Read an object back out of storage. Returns None when it cannot be read.

    The mirror of `upload_file`, and it has to cover the same three backends:
    local disk, R2, and the base64 data-URI fallback that `upload_file` returns
    when an org has no R2 credentials. In that last case there is no key at all
    and the bytes live in the stored URL, so `url` is accepted as a fallback
    source — without it, every org that predates R2 provisioning would be
    silently unreadable.

    Returns None rather than raising: a caller rebuilding a derived artefact
    should degrade, not 500.
    """
    if not key or key == "pending":
        return _bytes_from_data_uri(url)

    if LOCAL_STORAGE_PATH:
        target = Path(LOCAL_STORAGE_PATH) / key
        if target.exists():
            return target.read_bytes()
        return _bytes_from_data_uri(url)

    client, bucket = (None, None)
    if org_id:
        client, bucket = await _get_org_r2(org_id)
    if client is None:
        return _bytes_from_data_uri(url)

    try:
        loop = asyncio.get_running_loop()
        obj = await loop.run_in_executor(
            None, lambda: client.get_object(Bucket=bucket, Key=key)
        )
        return obj["Body"].read()
    except Exception as exc:
        log.warning("R2 download failed for bucket=%s key=%s: %s", bucket, key, exc)
        return _bytes_from_data_uri(url)


def _bytes_from_data_uri(url: Optional[str]) -> Optional[bytes]:
    if not url or not url.startswith("data:"):
        return None
    try:
        import base64
        return base64.b64decode(url.split(",", 1)[1])
    except Exception:
        return None


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
