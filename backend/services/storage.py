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

from fastapi import HTTPException

from services.encryption import decrypt

log = logging.getLogger(__name__)

LOCAL_STORAGE_PATH = os.getenv("LOCAL_STORAGE_PATH")
_local_base_url = os.getenv("LOCAL_STORAGE_URL", "http://localhost:8080/local-files")

_org_clients: dict[str, object] = {}

# ── Refusing is the correct outcome ──────────────────────────────────────────
#
# There used to be a third backend: with no bucket resolved, `upload_file`
# base64'd the bytes into the string it called "url" and every caller wrote that
# string straight into its column. Two of the three orgs had no R2 credentials
# of their own — Aekam Inc among them — so the vendor's own uploads took it,
# silently, while every screen reported success. Eleven files accumulated that
# way: four screen recordings, two screenshots, five executed e-sign PDFs, 99 MB
# in rows. Moving them to R2 on 2026-08-19 took the database from 82 MB to 49.
#
# A refused upload is a visible, recoverable failure. A stored one is an
# invisible, compounding cost that also cannot be re-signed, deleted on a
# retention schedule, or streamed. So this is raised instead.
#
# It is an HTTPException because the alternative is a 500 on every path that
# does not already wrap the call — `routers/esign.upload_document_file`,
# `server.py`'s task attachment route and `services/ai_router.generate_image`
# all call it bare — and a 500 tells the user nothing and the operator nothing
# either. `read_capped` in this same module already raises 413 from here for
# exactly that reason. Callers that catch and re-raise their own 503 (uploads,
# graha) are unaffected; they never see a different exception type than before,
# because before there was no exception at all.
_PLATFORM_VARS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME")


class StorageNotConfigured(HTTPException):
    """No bucket resolved for this upload. Carries the variables that are unset.

    `.missing` is the subset of the four platform variables that are actually
    absent, so the message says which ones to set rather than restating all four
    at whoever is reading the log. An EMPTY `.missing` is its own diagnosis: all
    four are present and the client would not build from them, which is a wrong
    value, not a missing one, and no amount of setting variables fixes it.
    """

    def __init__(self, org_id: Optional[str] = None):
        self.missing = [v for v in _PLATFORM_VARS if not os.getenv(v)]
        self.org_id = org_id
        if self.missing:
            detail = (
                "File storage is not configured — this file was not saved. "
                f"Unset: {', '.join(self.missing)}."
            )
        else:
            detail = (
                "File storage is not configured — this file was not saved. "
                f"{', '.join(_PLATFORM_VARS)} are all set but no storage client "
                "could be built from them."
            )
        super().__init__(503, detail)

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
    configured, which on a deployed server should not happen; `upload_file`
    logs it loudly and refuses rather than inventing somewhere to put the file.
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


# ── Reading an upload without buying the whole thing first ───────────────────
#
# Every upload path in this product already had a size limit. Three of the four
# applied it AFTER `await file.read()` — which is to say, after the entire body
# was resident in the worker. A 500MB POST to the e-sign endpoint was 500MB of
# RSS before the 20MB check rejected it, and there are two gunicorn workers on a
# container whose observed peak is 0.85GB against a 2GB ceiling. The limit was
# protecting storage; it was not protecting memory.
#
# `routers/uploads.py` already did it correctly, reading in 1MB chunks and
# abandoning mid-stream. This is that loop, in one place, so the other three
# paths stop being the exception.
_CHUNK = 1024 * 1024


async def read_capped(file, limit: int, label: Optional[str] = None) -> bytes:
    """
    Read a Starlette UploadFile, refusing past `limit` before it is all in memory.

    `label` is what the caller wants the user to read — "25 MB", "a 4 MB photo".
    Raises 413, which is the status the existing paths already return.
    """
    from fastapi import HTTPException

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, f"File exceeds the {label or _mb(limit)} limit")
        chunks.append(chunk)
    return b"".join(chunks)


async def read_body_capped(request, limit: int, label: Optional[str] = None) -> bytes:
    """
    The same guard for a RAW body — `await request.body()` has no limit at all.

    e-sign accepts a bare PDF as the request body when the content type is not
    multipart, and that branch could not be capped by reading the file object
    because there is no file object.
    """
    from fastapi import HTTPException

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, f"File exceeds the {label or _mb(limit)} limit")
        chunks.append(chunk)
    return b"".join(chunks)


def _mb(n: int) -> str:
    return f"{n // (1024 * 1024)} MB"


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

    # Ask before creating. `create_bucket` is an ACCOUNT-level operation, so a
    # bucket-scoped token — the least-privilege setup Cloudflare recommends, and
    # the one `verify_r2_credentials` now accepts — is refused here even though
    # the bucket it points at already exists and works. Heading it first turns
    # that from a logged error into the no-op it actually is.
    try:
        await loop.run_in_executor(None, lambda: client.head_bucket(Bucket=bucket))
        return bucket
    except Exception:
        pass

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
            # Not fatal: a bucket-scoped token cannot create, and does not need
            # to — the operator creates the bucket in the Cloudflare dashboard.
            # The org is still configured; uploads will resolve once it exists.
            log.error("Failed to create R2 bucket %s for org %s: %s", bucket, org_id, exc)
            return None

    return bucket


# ── Verifying a credential without demanding an account-level permission ─────
#
# This check used to call `list_buckets` and nothing else, and `list_buckets` is
# an ACCOUNT-level operation. A Cloudflare API token scoped to a single bucket —
# the least-privilege setup Cloudflare's own docs recommend — cannot list
# buckets, though it can read and write that bucket perfectly. So the correct
# credential was rejected, and because `CreateOrgPanel` blocks the Create button
# until verification passes, a correctly-scoped token stopped an org being
# created at all.
#
# The second half of the same bug: the verifier never tested the BUCKET. The
# caller passes an `R2Credentials` that carries `bucket_name`, and only three of
# its four fields were forwarded — so "verified" never meant "the bucket these
# files are going to is reachable", which is the only thing the operator wanted
# to know.
#
# So the bucket is now the primary probe and the account listing is a bonus:
# a token that can reach its bucket verifies, whether or not it may enumerate.
_CREDENTIAL_FAULTS = {
    "InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidArgument",
    "AuthorizationHeaderMalformed", "TokenRefreshRequired", "ExpiredToken",
    "InvalidSecurity", "Unauthorized",
}


def _error_code(exc) -> str:
    """The S3 error code inside a botocore ClientError, or '' for anything else."""
    resp = getattr(exc, "response", None)
    if isinstance(resp, dict):
        return str(resp.get("Error", {}).get("Code") or "")
    return ""


def _http_status(exc) -> int:
    resp = getattr(exc, "response", None)
    if isinstance(resp, dict):
        try:
            return int(resp.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0)
        except (TypeError, ValueError):
            return 0
    return 0


async def verify_r2_credentials(
    account_id: str,
    access_key: str,
    secret_key: str,
    bucket_name: Optional[str] = None,
) -> dict:
    """Test R2 credentials against the bucket they are for.

    Returns::

        {valid, buckets, error, scope, bucket, bucket_exists, can_list_buckets, checks}

    `scope` is "account" when the token may enumerate buckets and "bucket" when
    it is scoped to one — both are valid; the field exists so the operator can
    see which kind of token they pasted rather than guessing from an error.

    `bucket_exists` is False with `valid` True for a real, well-scoped token
    whose bucket has not been created yet: that is the normal state on a new
    org, and `create_org_bucket` is what fixes it. A missing bucket is not a
    bad credential and must not be reported as one.
    """
    checks: list[dict] = []
    try:
        client = _build_client(account_id, access_key, secret_key)
    except Exception as exc:
        return {
            "valid": False, "buckets": [], "error": f"Could not build a client: {exc}",
            "scope": None, "bucket": bucket_name, "bucket_exists": None,
            "bucket_writable": False, "probe_round_trip": False,
            "can_list_buckets": False, "checks": checks,
        }

    loop = asyncio.get_running_loop()

    # 1. Account-level listing. Its FAILURE proves nothing — a bucket-scoped
    #    token is supposed to fail here — so nothing below branches on it
    #    except to record the scope and fill `buckets` when it does work.
    bucket_names: list[str] = []
    can_list = False
    list_error = None
    try:
        result = await loop.run_in_executor(None, client.list_buckets)
        bucket_names = [b["Name"] for b in (result or {}).get("Buckets", [])]
        can_list = True
        checks.append({"check": "list_buckets", "ok": True, "detail": f"{len(bucket_names)} bucket(s)"})
    except Exception as exc:
        list_error = exc
        checks.append({"check": "list_buckets", "ok": False, "detail": _error_code(exc) or str(exc)})

    # 2. The bucket itself — the probe that actually answers the question.
    bucket = bucket_name or None
    bucket_exists = None
    bucket_readable = False
    bucket_writable = False
    probe_round_trip = False
    probe_error = None
    bucket_error = None
    if bucket:
        try:
            await loop.run_in_executor(None, lambda: client.head_bucket(Bucket=bucket))
            bucket_exists = True
            checks.append({"check": "head_bucket", "ok": True, "detail": bucket})
        except Exception as exc:
            code, status = _error_code(exc), _http_status(exc)
            if code in ("404", "NoSuchBucket", "NotFound") or status == 404:
                # Authenticated fine; the bucket is simply not there yet.
                bucket_exists = False
                checks.append({"check": "head_bucket", "ok": True,
                               "detail": f"{bucket} does not exist yet"})
            else:
                bucket_error = exc
                checks.append({"check": "head_bucket", "ok": False,
                               "detail": code or str(exc)})

        if bucket_exists:
            try:
                await loop.run_in_executor(
                    None, lambda: client.list_objects_v2(Bucket=bucket, MaxKeys=1),
                )
                bucket_readable = True
                checks.append({"check": "list_objects", "ok": True, "detail": bucket})
            except Exception as exc:
                bucket_error = bucket_error or exc
                checks.append({"check": "list_objects", "ok": False,
                               "detail": _error_code(exc) or str(exc)})

            # -- The probe: do the thing, do not merely ask about it ---------
            #
            # Everything above is a permission question. This is the capability
            # the operator is actually buying - a file goes in, comes back
            # identical, and can be removed again - and it is the only step that
            # would catch a bucket that exists, lists, and rejects every PUT.
            # Under `_probe/`, a uuid name, 9 bytes, deleted immediately; the
            # delete runs in a `finally` so a failed read-back still cleans up
            # after itself rather than leaving litter in a paying customer's
            # bucket.
            probe_key = f"_probe/{uuid.uuid4().hex}.txt"
            probe_body = b"kartavya\n"
            wrote = False
            try:
                await loop.run_in_executor(None, lambda: client.put_object(
                    Bucket=bucket, Key=probe_key, Body=probe_body,
                    ContentType="text/plain",
                ))
                wrote = True
                bucket_writable = True
                checks.append({"check": "put_object", "ok": True, "detail": probe_key})
                try:
                    got = await loop.run_in_executor(None, lambda: client.get_object(
                        Bucket=bucket, Key=probe_key,
                    ))
                    body = got["Body"].read()
                    if body == probe_body:
                        probe_round_trip = True
                        checks.append({"check": "get_object", "ok": True,
                                       "detail": f"{len(body)} bytes, identical"})
                    else:
                        checks.append({"check": "get_object", "ok": False,
                                       "detail": "read back different bytes"})
                except Exception as exc:
                    checks.append({"check": "get_object", "ok": False,
                                   "detail": _error_code(exc) or str(exc)})
            except Exception as exc:
                probe_error = exc
                checks.append({"check": "put_object", "ok": False,
                               "detail": _error_code(exc) or str(exc)})
            finally:
                if wrote:
                    try:
                        await loop.run_in_executor(None, lambda: client.delete_object(
                            Bucket=bucket, Key=probe_key,
                        ))
                        checks.append({"check": "delete_object", "ok": True,
                                       "detail": probe_key})
                    except Exception as exc:
                        # Left behind: 9 bytes under `_probe/`. Worth saying,
                        # never worth failing a verification over.
                        checks.append({"check": "delete_object", "ok": False,
                                       "detail": _error_code(exc) or str(exc)})

    # 3. The verdict.
    #    Valid when EITHER the account listing worked (an account-scoped token)
    #    OR the bucket answered (a bucket-scoped one, including the not-yet-
    #    created case, where the 404 is itself proof the signature was accepted).
    valid = can_list or bucket_exists is True or bucket_exists is False
    if valid:
        scope = "account" if can_list else "bucket"
        error = None
        if bucket and bucket_exists and not bucket_writable:
            # The bucket is there and this token cannot put an object in it.
            # Still `valid` - the credential authenticated, and an operator who
            # is about to widen the token scope should see the credential
            # accepted and the reason named, not a flat rejection that says
            # neither. But it is the sentence that matters most on this screen,
            # because a read-only token means every upload this org makes fails.
            error = (
                f"Credentials are valid, but writing to {bucket} was refused "
                f"({_error_code(probe_error) or probe_error or 'no write permission'}). "
                "Uploads will fail until this token can write to the bucket."
            )
        elif bucket and bucket_exists and not probe_round_trip:
            error = (
                f"Credentials are valid and can write to {bucket}, but the test "
                "object did not read back. Uploads will work; signed download "
                "links may not."
            )
        elif bucket and bucket_exists and not bucket_readable:
            error = (
                f"Credentials are valid and can write to {bucket}, but listing it "
                f"was refused ({_error_code(bucket_error) or bucket_error}). "
                "Uploads and downloads work; storage usage cannot be measured."
            )
    else:
        scope = None
        primary = bucket_error or list_error
        code = _error_code(primary)
        if code in _CREDENTIAL_FAULTS:
            error = f"R2 rejected these credentials ({code})."
        elif code == "AccessDenied" and bucket:
            error = (
                f"The credentials authenticated, but this token has no access to "
                f"bucket '{bucket}'. Check the token's bucket scope."
            )
        else:
            error = str(primary) if primary is not None else "R2 did not respond."

    return {
        "valid": valid,
        "buckets": bucket_names,
        "error": error,
        "scope": scope,
        "bucket": bucket,
        "bucket_exists": bucket_exists,
        "bucket_writable": bucket_writable,
        "probe_round_trip": probe_round_trip,
        "can_list_buckets": can_list,
        "checks": checks,
    }


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
    Falls back to the platform bucket, and to the local filesystem when
    LOCAL_STORAGE_PATH is set.
    Raises StorageNotConfigured when none of them resolves. A file is never
    returned as bytes-in-a-URL, on any configuration.
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
    if client is None:
        # `_resolve_r2` has already tried the org's own bucket AND the vendor's,
        # so on a deployed server reaching here means the platform variables are
        # missing. There is nowhere to put this file and it does not go in a
        # column — see the StorageNotConfigured banner above for the 99 MB that
        # taught us.
        #
        # ERROR, not warning: the 503 raised on the next line is a handled
        # HTTPException, so it never reaches Sentry on its own, and the symptom
        # at the other end is one user reporting that a form "did not work".
        log.error(
            "NO R2 for org %s and no platform bucket — REFUSING %s (%d bytes). "
            "Set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / "
            "R2_BUCKET_NAME.",
            org_id, filename, len(file_bytes),
        )
        raise StorageNotConfigured(org_id=org_id)

    key = f"{key_prefix}{key}"

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


# ── The key decides the bucket, on every read ────────────────────────────────
#
# `sign_key` learned this rule when the platform bucket was added and the other
# three readers did not, which made every object the platform bucket holds
# write-only: `download_file` and `delete_file` asked `_get_org_r2` alone, so
# for the two orgs with no R2 credentials of their own — Aekam Inc among them —
# they resolved (None, None) and answered "not readable" for a file that was
# sitting in the vendor's bucket under the key the row already stored.
#
# It was not a cosmetic miss. `esign._generate_signed_pdf` reads the contract
# back through `download_file` to append its pages, and reads each signature
# back through it to draw them; both returning None produced an executed PDF
# that was one signature page with a blank rule where every signature belonged,
# and `esign_service.send_for_signature` answered "re-upload the file and try
# again" for a file that was already there — a loop that could not clear,
# because the re-upload landed in the same unreadable place.
#
# So the rule lives in one function that all four call. A key beginning `org/`
# or `shared/` was written to the platform bucket and stays there, whatever the
# org's credentials say TODAY: an org that brings its own Cloudflare account
# later keeps reading everything it stored before, instead of having each old
# key signed against a new empty bucket and 404.
async def _client_for_key(org_id: Optional[str], key: str) -> tuple[object, str] | tuple[None, None]:
    """The client and bucket that hold `key`. (None, None) if neither resolves."""
    if key.startswith(_PLATFORM_PREFIX) or key.startswith("shared/"):
        return _platform_r2()
    if org_id:
        return await _get_org_r2(org_id)
    return None, None


async def sign_key(org_id: str, key: str) -> Optional[str]:
    """
    Generate a fresh presigned URL for an R2 key. None if R2 is not configured.

    The KEY decides the bucket, not the org's current configuration — see
    `_client_for_key` above, which this and the three other readers share.
    """
    if not key or not org_id:
        return None
    if LOCAL_STORAGE_PATH:
        return f"{_local_base_url}/{key}"

    client, bucket = await _client_for_key(org_id, key)
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

        # R2 presigns path-style, so the path is `<bucket>/<key>` and WHICH
        # bucket name is in it is the only record of where the object went.
        # Stripping the org's name unconditionally was wrong for everything the
        # platform bucket holds: the path carries the PLATFORM bucket's name, so
        # the prefix never matched, and the key was signed as
        # `kartavaya-platform/org/<id>/…` against the org's own bucket — a fresh,
        # valid-looking URL that 404s. Both candidates are tried, then the key
        # itself picks the bucket, the same way `sign_key` does.
        _, platform_bucket = _platform_r2()
        org_bucket = None
        if org_id:
            _org_client, org_bucket = await _get_org_r2(org_id)
        for name in (org_bucket, platform_bucket):
            if name and full_key.startswith(name + "/"):
                full_key = full_key[len(name) + 1:]
                break

        client, bucket = await _client_for_key(org_id, full_key)
        if not client:
            return old_url
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

    The mirror of `upload_file` for the two backends it writes — local disk and
    R2 — plus one it no longer does. The data-URI decode below STAYS, and that
    is a decision rather than an oversight: writing bytes into a column is the
    thing being stopped, reading a value somebody already stored is harmless and
    costs one `startswith` on a path that has already failed.

    Nothing in the database can produce one today; the eleven rows that held
    data URIs were repointed at R2 on 2026-08-19. But `url` is supplied by the
    CALLER, not read from here — `esign._generate_signed_pdf` passes
    `doc["file_url"]` out of a row it fetched — and a row restored from a
    backup, an export, or a cached payload can still carry the old shape.
    Dropping the decode would turn those into a silently blank artefact, which
    is how five executed e-sign PDFs became unservable in the first place.

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

    client, bucket = await _client_for_key(org_id, key)
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
    # The same key-decides-the-bucket rule, and for a sharper reason than the
    # readers have: an org WITH its own bucket used to have a platform key
    # deleted against that bucket, where S3 answers 204 for an object that was
    # never there. So this returned True — the Pahchan retention sweeper marked
    # the row purged, and the photo it was purging stayed in the platform bucket
    # for good, with nothing left pointing at it to try again.
    client, bucket = await _client_for_key(org_id, key)
    if client is None:
        return False
    try:
        client.delete_object(Bucket=bucket, Key=key)
        return True
    except Exception as exc:
        log.warning("R2 delete failed for bucket=%s key=%s: %s", bucket, key, exc)
        return False
