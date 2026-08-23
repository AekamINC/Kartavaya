"""
esign.py — In-house e-signature module.

Flow: Upload PDF → Add signers → Send → Signer opens link → OTP verify → Sign → Done
Legal basis: IT Act §10A — e-contracts valid, no prescribed signature form.
Audit trail proves: (1) signature links to signatory (OTP), (2) signatory control,
(3) alterations detectable (SHA-256), (4) Contract Act essentials met.
"""
import asyncio
import hashlib
import json
import logging
import os
import random
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services import storage
from services.storage import upload_file, _get_org_r2

# The three e-sign facts a rule can hang off. Module-level rather than inside
# the handlers (the graha/vikray sites import at the call site) so a test can
# monkeypatch the emitter in THIS module's namespace — the same reason the
# handlers call the names below rather than reaching into services.niyam.
from services.niyam.subjects import document_declined, document_sent, document_signed

# E-sign is the ONLY place this product stores a PDF. Everything else it calls a
# PDF — invoices, payslips, reports, the cost and analytics packs — is rendered
# from the row data on request and streamed to the browser; not one of those
# nine modules calls `upload_file`, so none of them occupies a byte.
#
# 10MB, down from 20. The merged output is the original plus our signature page,
# so the ceiling on what we store is very nearly this number. A born-digital
# contract is a few hundred KB; 10MB is already a long scanned document, and
# the cap is now enforced before the body is resident rather than after.
_MAX_PDF_BYTES = 10 * 1024 * 1024

# ── The signature is a FILE, and it stopped being a column ───────────────────
#
# `signature_data` reaches this module from the PUBLIC signing endpoint as a
# canvas PNG data URI and went into `staging.sign_signers` verbatim: image bytes
# in an unbounded TEXT column, written by a caller whose entire authority is a
# token that travels through mail relays and corporate archives. It is the same
# shape that accumulated 99MB inside the database — four screen recordings, two
# screenshots, five executed PDFs — before those rows were repointed at R2 on
# 2026-08-19.
#
# The bytes go to R2 and the column holds `r2:<key>`: a POINTER, with a scheme
# on the front so it is self-describing and cannot be confused with either of
# the two things this column legitimately still holds — a TYPED signature, which
# is a person's name and not a file, and the one legacy inline row (7.9 kB) that
# was deliberately left as it was.
#
# `signature_type` is NOT the marker, and it was the first candidate because it
# needs no new column either. It is the wrong column: it records HOW the party
# signed — `services/esign_signed_doc._METHOD` prints it on the executed
# signature page as "Drawn"/"Typed"/"Uploaded image" and
# `_generate_signed_certificate` emits it into the audit certificate. A value
# there meaning "the bytes live elsewhere" would replace a fact about the
# signatory with a fact about our storage, in the two artefacts a court reads.
_SIGNATURE_KEY_SCHEME = "r2:"

# The only `data:` values that become an object. Anything else beginning `data:`
# is refused rather than stored: this is a JSON endpoint taking a client-supplied
# string, so a caller can put a file in a column while R2 is perfectly healthy,
# and that is independent of whether the fallback exists.
_SIGNATURE_IMAGE = re.compile(
    r"^data:image/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$", re.I,
)

# 512 KB of IMAGE, the same number as
# `services/esign_signed_doc.MAX_SIGNATURE_BYTES`: past it the executed PDF stops
# reproducing a signature and prints a note in its place, so accepting more is
# accepting bytes that can never be drawn. The field had no limit of any kind, on
# an endpoint that needs no session.
#
# Counted DECODED, because `esign_signed_doc.signature_mark` compares
# `len(base64.b64decode(...))`. Base64 is ASCII but it is not 1:1 — three bytes
# become four characters — so measuring the string against this number instead
# refuses every image over 384 KB, and a 400 KB scanned signature
# (`signature_type='upload'`) is an ordinary thing to send and one the executed
# page draws perfectly well.
_MAX_SIGNATURE_BYTES = 512 * 1024

# The same ceiling in the units the FIELD carries, so Pydantic still answers 422
# naming the field before an arbitrary number of megabytes is resident: the
# base64 of `_MAX_SIGNATURE_BYTES`, plus the longest `data:image/...;base64,`
# prefix and room for newlines a client may fold into it. Deliberately the looser
# of the two bounds — the exact one is checked on the decoded bytes, where the
# image actually exists.
_MAX_SIGNATURE_B64_CHARS = 4 * ((_MAX_SIGNATURE_BYTES + 2) // 3) + 64

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/esign", tags=["esign"])


def _rate_limit(bucket: dict, key: str, *, limit: int, window_s: int, message: str) -> None:
    """A fixed window, per key. Raises 429 when the key has used its budget.

    Lifted out of `verify_otp`, which had the only copy, so `send_otp` could
    have one too — that endpoint had NO limit of its own and each call re-issues
    an OTP, emails it, and OVERWRITES `otp_code`. Two consequences: an
    unauthenticated caller holding a token could mail-bomb the signer over our
    sender reputation, and could keep invalidating the code the real signer was
    typing in.

    A FRESH window starts once the old one lapses. The bug that motivated the
    original: `count >= limit AND elapsed < window` could never be true again
    after the first window expired, so the limiter switched itself off forever
    for that key.

    Lapsed windows are evicted, because the key is chosen by an unauthenticated
    caller and an unbounded dict is a memory leak an attacker controls.

    Process-local, and that is a known weakness rather than a design: not shared
    across workers, cleared by every deploy. The durable home is the
    `otp_attempts` column; moving it there is a schema change and is reported,
    not made here.
    """
    now = datetime.now(timezone.utc)
    for _k in [k for k, v in bucket.items() if (now - v["first_at"]).total_seconds() >= window_s]:
        del bucket[_k]

    current = bucket.get(key)
    if current is None or (now - current["first_at"]).total_seconds() >= window_s:
        current = {"count": 0, "first_at": now}
    if current["count"] >= limit:
        raise HTTPException(429, message)
    current["count"] += 1
    bucket[key] = current


async def _doc_for_reader(pool, doc_id: str, org_id: str, user_id: str):
    """One document, if this caller is allowed to see where it came from.

    Four endpoints fetched a document by id with `WHERE id=$1 AND org_id=$2` and
    nothing else. That was correct until Ganit contracts started arriving here:
    a SENSITIVE module's title, description and stored PDF became a
    `sign_documents` row, and the e-sign grant alone was enough to read one.
    See `services/esign_service.visible_source_modules` for why the answer is a
    source filter rather than un-routing the feature.

    404 rather than 403, deliberately and for the usual reason — a 403 confirms
    the document exists, which tells a reader without the Ganit grant exactly
    how many contracts their colleagues are circulating.

    `source_module IS NULL` means the document was created in the e-Sign module
    itself. That is every one of the 75 rows that existed before this change.
    """
    from services.esign_service import visible_source_modules
    allowed = await visible_source_modules(pool, user_id, org_id)
    return await pool.fetchrow(
        "SELECT * FROM staging.sign_documents "
        "WHERE id=$1::uuid AND org_id=$2::uuid "
        "  AND (source_module IS NULL OR source_module = ANY($3::text[]))",
        uuid.UUID(doc_id), org_id, allowed,
    )


async def _refresh_file_url(org_id: str, key: str, url: str) -> str:
    """Re-sign an R2 URL using the org's credentials and the stored key."""
    if not key or key == "pending" or not org_id:
        return url or ""
    from services.storage import sign_key
    return await sign_key(org_id, key) or url or ""


async def _refresh_artefact_urls(org_id: str, d: dict) -> dict:
    """Re-sign every stored object on a document row.

    Three of them now, and they are three different things: the file presented
    for signature, the executed PDF, and the JSON audit certificate. Done in one
    place so a new artefact cannot be added to the schema and then quietly
    served with a nine-hour-expired presigned URL from one endpoint but not the
    other — which is exactly the drift that let the certificate masquerade as
    the signed file for as long as it did.
    """
    d["file_url"] = await _refresh_file_url(org_id, d.get("file_key"), d.get("file_url"))
    for key_col, url_col in (("signed_file_key", "signed_file_url"),
                             ("certificate_file_key", "certificate_file_url")):
        if d.get(key_col):
            d[url_col] = await _refresh_file_url(org_id, d[key_col], d.get(url_col))
    return d


async def _store_signature_image(
    signature_data: str,
    org_id: str,
    *,
    doc_id: str = "",
    signer_id: str = "",
) -> str:
    """A drawn or uploaded signature as an object key. A typed name passes through.

    Returns what belongs in `sign_signers.signature_data`: `r2:<key>` when the
    caller sent an image, and the value unchanged when they sent text.

    Any OTHER `data:` value is refused with a 422 naming the field. A signature
    is a small image or a person's name; `data:application/pdf;base64,…` here is
    a file being posted into a TEXT column through the one endpoint in this
    module that needs no session.

    The size ceiling is checked HERE, on the decoded image, because that is the
    length the signature page measures before deciding to draw it. The field
    bound on `SignatureSubmit` counts base64 characters, which is four per three
    bytes, so it cannot be the same number and is not asked to be.

    The upload happens before anything is flipped, so a storage failure is a 503
    the signer can retry rather than a half-signed row — `upload_file` raises
    `StorageNotConfigured` (503) rather than handing back bytes-in-a-URL.
    """
    raw = (signature_data or "").strip()
    if not raw.lower().startswith("data:"):
        return raw

    m = _SIGNATURE_IMAGE.match(raw)
    if not m:
        raise HTTPException(
            422, "signature_data must be a signature image (PNG, JPEG, GIF or "
                 "WebP) or typed text.",
        )

    import base64
    try:
        image = base64.b64decode(re.sub(r"\s+", "", m.group(2)), validate=True)
    except Exception as exc:
        raise HTTPException(422, "signature_data is not a readable image.") from exc
    if not image:
        raise HTTPException(422, "signature_data carries no image.")
    if len(image) > _MAX_SIGNATURE_BYTES:
        raise HTTPException(
            422, f"signature_data is larger than {_MAX_SIGNATURE_BYTES // 1024} KB "
                 "— past that the executed document prints a note in place of the "
                 "signature, so it is refused rather than stored unreproducible.",
        )

    subtype = m.group(1).lower()
    subtype = "jpeg" if subtype == "jpg" else subtype
    # ── THE DOCUMENT IS IN THE KEY NOW, AND IT WAS NOT ──────────────────────
    #
    # `folder="esign/signatures"` put EVERY signature ever captured, for every
    # document, in one flat prefix. Proposal 83 §3 names it: "to answer 'show me
    # the files for this agreement' you must query the database; the bucket
    # cannot answer it." Nor could deleting an agreement delete its files,
    # because its files were not gathered anywhere.
    #
    # `esign/{document_id}/signature/{signer}/YYYY/MM/…` — the grammar
    # (proposal 83 §4). The signer id rather than a user id because an external
    # party acting through a token is not a product user; it is still the
    # "who did it" segment the grammar asks for, and it is the one that lets a
    # signer's own captures be found without reading the database.
    result = await upload_file(
        file_bytes=image,
        filename=f"signature.{'jpg' if subtype == 'jpeg' else subtype}",
        content_type=f"image/{subtype}",
        user_id=str(signer_id) if signer_id else "",
        module="esign",
        scope=[str(doc_id), "signature"],
        org_id=org_id,
    )
    key = (result or {}).get("key") or ""
    if not key:
        # `pahchan.py` refuses a punch photo on the same condition for the same
        # reason: an object nothing can NAME cannot be re-signed once its
        # nine-hour URL lapses, which is precisely how five executed e-sign PDFs
        # became permanently unservable.
        raise HTTPException(
            503, "File storage is not configured for this organisation — the "
                 "signature was not saved, so nothing was signed.",
        )
    return f"{_SIGNATURE_KEY_SCHEME}{key}"


async def _signature_for_render(value, org_id: str) -> str:
    """A stored signature put back inline, in memory, for the PDF only.

    `services/esign_signed_doc.signature_mark` embeds a bounded `data:` image or
    escapes the value as text, and it has to keep doing exactly that — for the
    one legacy inline row and for every typed name. So the key is resolved HERE,
    where there is a pool and an event loop, and the renderer is handed the shape
    it has always been handed.

    An object that will not come back yields "" — the blank ruled space the page
    already draws for a signature it cannot reproduce — never the key itself,
    which would print storage internals into a document a court reads.
    `POST /documents/{id}/rebuild` is the second attempt.
    """
    raw = str(value or "")
    if not raw.startswith(_SIGNATURE_KEY_SCHEME):
        return raw

    key = raw[len(_SIGNATURE_KEY_SCHEME):]
    from services.storage import download_file
    data = await download_file(key, org_id)
    if not data:
        log.error("esign: signature object %s (org %s) could not be read — the "
                  "executed page will carry a blank rule for that signatory", key, org_id)
        return ""

    import base64
    subtype = key.rsplit(".", 1)[-1].lower() if "." in key else "png"
    subtype = "jpeg" if subtype == "jpg" else subtype
    if subtype not in ("png", "jpeg", "gif", "webp"):
        subtype = "png"
    return f"data:image/{subtype};base64,{base64.b64encode(data).decode()}"


_esign_gate = require_module("esign")

# kartavaya.com, NOT kartavya.com — this default carried the misspelling, so an
# unset FRONTEND_URL would have mailed every signer a link to a domain Aekam
# does not own. The app, not the marketing site: see email_service.FRONTEND_URL.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://app.kartavaya.com").rstrip("/")

BLOCKED_DOC_TYPES = [
    "negotiable_instrument", "power_of_attorney", "trust_deed",
    "will", "immovable_property_transfer",
]


# ── Pydantic models ──────────────────────────────────────────

class SignerInput(BaseModel):
    name: str
    email: EmailStr
    phone: str = ""
    sign_order: int = 1


class DocumentCreate(BaseModel):
    title: str
    description: str = ""
    signers: list[SignerInput]
    expires_days: int = 30
    message: str = ""


class OTPVerify(BaseModel):
    otp: str


class SignatureSubmit(BaseModel):
    #: Bounded because an unbounded string on a public endpoint is an unbounded
    #: row, and Pydantic answers 422 naming the field before the body is
    #: resident. The bound is `_MAX_SIGNATURE_B64_CHARS`, NOT
    #: `_MAX_SIGNATURE_BYTES`: this field carries base64, four characters per
    #: three bytes, and spending the byte number on characters refused every
    #: signature between 384 KB and 512 KB — sizes a scanned signature reaches
    #: and the executed page reproduces. The 512 KB the page can actually draw
    #: is enforced on the decoded image in `_store_signature_image`.
    signature_data: str = Field(max_length=_MAX_SIGNATURE_B64_CHARS)
    signature_type: str = "draw"


# ── Document CRUD ────────────────────────────────────────────

@router.get("/documents")
async def list_documents(
    status: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    pool = await get_pool()

    # A document that came from a SENSITIVE module is only visible to a reader
    # who holds that module. Routing Ganit contracts through e-Sign put a
    # sensitive module's title, description and stored PDF into a
    # non-sensitive module's table, where the e-sign grant alone was enough to
    # read it. See `esign_service.visible_source_modules`. Documents created in
    # the e-Sign module itself carry NULL and are unaffected — that is all 75
    # existing rows.
    from services.esign_service import visible_source_modules
    allowed_sources = await visible_source_modules(pool, user["user_id"], org_id)

    q = ("SELECT * FROM staging.sign_documents "
         "WHERE org_id=$1::uuid "
         "  AND (source_module IS NULL OR source_module = ANY($2::text[]))")
    args = [org_id, allowed_sources]
    if status:
        q += " AND status=$3"
        args.append(status)
    q += " ORDER BY created_at DESC LIMIT 50"
    rows = await pool.fetch(q, *args)
    docs = []
    for r in rows:
        docs.append(await _refresh_artefact_urls(org_id, dict(r)))
    return {"data": docs}


@router.post("/documents")
async def create_document(
    body: DocumentCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    """Create a signing document. File must be uploaded separately via /upload then referenced."""
    if not body.signers:
        raise HTTPException(400, "At least one signer is required")
    if len(body.signers) > 10:
        raise HTTPException(400, "Maximum 10 signers per document")

    pool = await get_pool()

    doc = await pool.fetchrow(
        "INSERT INTO staging.sign_documents "
        "(org_id, title, description, file_key, file_url, file_hash, "
        " signers_total, expires_at, created_by) "
        "VALUES ($1::uuid, $2, $3, 'pending', 'pending', 'pending', "
        " $4, $5, $6) RETURNING *",
        org_id, body.title, body.description,
        len(body.signers),
        datetime.now(timezone.utc) + timedelta(days=body.expires_days),
        user["user_id"],
    )

    for s in body.signers:
        token = secrets.token_hex(32)
        await pool.execute(
            "INSERT INTO staging.sign_signers "
            "(document_id, name, email, phone, sign_order, token) "
            "VALUES ($1, $2, $3, $4, $5, $6)",
            doc["id"], s.name, s.email, s.phone or None, s.sign_order, token,
        )

    await _audit(pool, doc["id"], None, "document_created", user["user_id"], None, None,
                 {"title": body.title, "signers": len(body.signers)})

    return {"id": str(doc["id"]), "status": "draft"}


@router.post("/documents/{doc_id}/upload")
async def upload_document_file(
    doc_id: str,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    """Upload the PDF file for a signing document."""
    pool = await get_pool()

    doc = await _doc_for_reader(pool, doc_id, org_id, user["user_id"])
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc["status"] not in ("draft",):
        raise HTTPException(400, "Can only upload file for draft documents")

    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        form = await request.form()
        file = form.get("file")
        if not file:
            raise HTTPException(400, "No file uploaded")
        file_bytes = await storage.read_capped(file, _MAX_PDF_BYTES)
        filename = file.filename or "document.pdf"
    else:
        # `await request.body()` reads the whole thing with no limit whatsoever —
        # the size check below it only ever ran once the bytes were already in
        # the worker. This branch takes a bare PDF as the request body, so there
        # is no file object to cap and the stream has to be read directly.
        file_bytes = await storage.read_body_capped(request, _MAX_PDF_BYTES)
        filename = "document.pdf"

    if not file_bytes:
        raise HTTPException(400, "Empty upload")

    file_hash = hashlib.sha256(file_bytes).hexdigest()

    # `esign/{document_id}/original/{user}/YYYY/MM/{id}--the-real-filename.pdf`.
    # The original name survives now: the key was a bare uuid, so "I uploaded
    # Supply-Agreement.pdf" could not be answered from storage at all.
    upload_result = await upload_file(
        file_bytes=file_bytes,
        filename=filename,
        content_type="application/pdf",
        user_id=user["user_id"],
        module="esign",
        scope=[str(doc_id), "original"],
        org_id=org_id,
    )

    await pool.execute(
        "UPDATE staging.sign_documents SET file_key=$1, file_url=$2, file_hash=$3, "
        "updated_at=NOW() WHERE id=$4",
        upload_result.get("key", ""), upload_result["url"], file_hash,
        uuid.UUID(doc_id),
    )

    await _audit(pool, uuid.UUID(doc_id), None, "file_uploaded", user["user_id"], None, None,
                 {"filename": filename, "size": len(file_bytes), "hash": file_hash})

    return {"file_url": upload_result["url"], "file_hash": file_hash}


@router.get("/documents/{doc_id}")
async def get_document(
    doc_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    pool = await get_pool()
    doc = await _doc_for_reader(pool, doc_id, org_id, user["user_id"])
    if not doc:
        raise HTTPException(404, "Document not found")

    signers = await pool.fetch(
        "SELECT id, name, email, phone, sign_order, status, signed_at, signature_type "
        "FROM staging.sign_signers WHERE document_id=$1 ORDER BY sign_order",
        uuid.UUID(doc_id),
    )

    # `actor_name` added 2026-08-07. The row stores an address because a signer
    # is often an external party with no account here — but this document's own
    # signer list carries their NAME, and the trail printed the address while the
    # panel two inches above it printed the name for the same person. Resolved by
    # `signer_id` first (exact) and by address second (rows written before the id
    # column was populated). The address stays in the payload: it is what the
    # signature is legally attributed to, and `SignatureDetail` prints it under
    # the name deliberately.
    audit = await pool.fetch(
        "SELECT a.action, a.actor_email, a.details, a.created_at, "
        "       NULLIF(TRIM(COALESCE(s1.name, s2.name)), '') AS actor_name "
        "FROM staging.sign_audit_log a "
        "LEFT JOIN staging.sign_signers s1 ON s1.id = a.signer_id "
        "LEFT JOIN staging.sign_signers s2 ON s2.document_id = a.document_id "
        "                                 AND lower(s2.email) = lower(a.actor_email) "
        "WHERE a.document_id=$1 ORDER BY a.created_at",
        uuid.UUID(doc_id),
    )

    doc_dict = dict(doc)
    await _refresh_artefact_urls(org_id, doc_dict)
    return {
        "document": doc_dict,
        "signers": [dict(s) for s in signers],
        "audit_trail": [dict(a) for a in audit],
    }


# ── Send for signing ─────────────────────────────────────────

@router.post("/documents/{doc_id}/send")
async def send_for_signing(
    doc_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    """Send the document to all signers via email."""
    pool = await get_pool()

    doc = await _doc_for_reader(pool, doc_id, org_id, user["user_id"])
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc["file_key"] == "pending":
        raise HTTPException(400, "Upload a file first")
    if doc["status"] not in ("draft",):
        raise HTTPException(400, "Document already sent")

    signers = await pool.fetch(
        "SELECT * FROM staging.sign_signers WHERE document_id=$1 ORDER BY sign_order",
        uuid.UUID(doc_id),
    )
    if not signers:
        raise HTTPException(400, "No signers added")

    from email_service import send_email

    for signer in signers:
        sign_url = f"{FRONTEND_URL}/sign/{signer['token']}"
        html = _build_signing_email(doc["title"], signer["name"], sign_url, doc.get("description", ""))
        try:
            send_email(
                to_email=signer["email"],
                subject=f"Please sign: {doc['title']}",
                html_content=html,
                # Names the outbound_log row (098 asks for the 'unclassified'
                # bucket to fall) and chooses the From address. All three
                # signing purposes share the 'notifications' bucket in
                # `services/email_senders._BUCKET` on purpose: request, code
                # and reminder are one conversation, and three different
                # senders for one signing is three reasons to distrust it.
                purpose="signature_request",
                ref=f"signature_request:{signer['id']}",
            )
            await pool.execute(
                "UPDATE staging.sign_signers SET status='sent', updated_at=NOW() WHERE id=$1",
                signer["id"],
            )
        except Exception as e:
            log.error("Failed to send signing email to %s: %s", signer["email"], e)

    # The status flip IS the send, so the `document.sent` event rides the same
    # transaction: it exists iff the flip committed and is gone if it rolls
    # back (services/niyam/emit.py — the emitter takes the business write's own
    # connection, never a pool). RETURNING * because the emitter reads `title`
    # and `signers_total` off the row as flipped. This is the last moment an
    # e-sign event has a product user as its actor: the person pressing send.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            _row = await _conn.fetchrow(
                "UPDATE staging.sign_documents SET status='sent', updated_at=NOW() "
                "WHERE id=$1 RETURNING *",
                uuid.UUID(doc_id),
            )
            if _row is not None:
                await document_sent(
                    _conn, org_id=org_id, actor_id=user["user_id"],
                    document_id=_row["id"], row=dict(_row),
                )

    await _audit(pool, uuid.UUID(doc_id), None, "document_sent", user["user_id"], None, None,
                 {"signers_count": len(signers)})

    return {"status": "sent", "signers_notified": len(signers)}


# ── Public signing endpoints (no auth — token-based) ─────────

def _doc_status_guard(doc_status: str, expires_at) -> None:
    """Refuse a document that is no longer open to signature.

    Lives in one place because it is the answer to "is this document still
    signable", and the read path and the two write paths must never be able to
    answer it differently. `get_signing_page` enforced it; `submit_signature`
    and `decline_signing` did not, which meant a cancelled document could still
    be signed by anyone holding a link issued before the cancellation.

    Raises 410 Gone rather than 404: the link was real, and telling the signer
    "cancelled or expired" is what lets them go back to the sender instead of
    assuming they were sent a broken link.
    """
    if doc_status in ("cancelled", "expired"):
        raise HTTPException(410, "This document has been cancelled or expired")
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(410, "This signing link has expired")


@router.get("/verify/{token}")
async def get_signing_page(token: str, request: Request):
    """Public endpoint — signer opens their signing link."""
    pool = await get_pool()

    signer = await pool.fetchrow(
        "SELECT s.*, d.title, d.description, d.file_url, d.file_key, d.file_hash, d.status as doc_status, "
        "d.expires_at, d.org_id "
        "FROM staging.sign_signers s "
        "JOIN staging.sign_documents d ON d.id = s.document_id "
        "WHERE s.token=$1",
        token,
    )
    if not signer:
        raise HTTPException(404, "Invalid signing link")

    # Persist the expiry transition before raising, so the document stops
    # showing as 'sent' on the firm's side the moment anyone opens a dead link.
    if (signer["doc_status"] not in ("cancelled", "expired")
            and signer["expires_at"] and signer["expires_at"] < datetime.now(timezone.utc)):
        await pool.execute(
            "UPDATE staging.sign_documents SET status='expired' WHERE id=$1",
            signer["document_id"],
        )
    _doc_status_guard(signer["doc_status"], signer["expires_at"])

    if signer["status"] == "signed":
        return {"status": "already_signed", "signed_at": signer["signed_at"]}

    # ── THIS GET NO LONGER WRITES ───────────────────────────────────────────
    #
    # It used to set status='opened' and write a `link_opened` audit row
    # carrying the caller's IP and user-agent. On an UNAUTHENTICATED GET that is
    # not evidence of a signer opening anything: corporate mail-security
    # scanners and inbox prefetchers follow every link in every message before a
    # human sees it. Staging already shows 8 `link_opened` rows across 5
    # distinct IPs against far fewer real openings.
    #
    # That matters more here than in an ordinary endpoint, because the audit
    # trail IS the product: it is the IT Act §10A claim that the signature links
    # to the signatory. A row asserting a signer opened the document at an IP a
    # scanner owns is evidence that is wrong, and wrong evidence is worse than
    # missing evidence when somebody disputes a contract.
    #
    # The open is now recorded where a HUMAN is demonstrably present: requesting
    # the OTP, which is a POST nothing prefetches. See `send_otp`.

    # ── AND IT NO LONGER HANDS OVER THE DOCUMENT ────────────────────────────
    #
    # `file_url` was a presigned R2 URL returned on the first call, so the token
    # ALONE read the document and the OTP gated only the signature. A signing
    # token travels through mail relays, forwarded threads, corporate archives
    # and browser history; treating it as sufficient to read a contract is the
    # thing the OTP exists to prevent.
    #
    # The signer still sees the document before signing — they see it after
    # verifying, which is the order the flow already claimed to have.
    verified = bool(signer["otp_verified"])

    return {
        "status": "pending",
        "document_title": signer["title"],
        "document_description": signer["description"],
        "file_url": (
            await _refresh_file_url(str(signer["org_id"]), signer.get("file_key"), signer.get("file_url"))
            if verified else None
        ),
        "signer_name": signer["name"],
        # Masked, like `send_otp` already returned it. Both endpoints are public
        # and both need only the token, so masking in one and not the other was
        # decoration rather than protection.
        "signer_email": _mask_email(signer["email"]),
        "otp_required": not verified,
    }


@router.post("/verify/{token}/otp/send")
async def send_otp(token: str, request: Request):
    """Send OTP to signer's email for identity verification."""
    pool = await get_pool()

    signer = await pool.fetchrow(
        "SELECT s.*, d.title, d.status as doc_status "
        "FROM staging.sign_signers s "
        "JOIN staging.sign_documents d ON d.id = s.document_id "
        "WHERE s.token=$1",
        token,
    )
    if not signer:
        raise HTTPException(404, "Invalid signing link")
    if signer["status"] == "signed":
        raise HTTPException(400, "Already signed")

    # Three per quarter-hour. This endpoint had NO limit of its own — only the
    # global 120-writes/min/IP in server.py, which an attacker rotating IPs does
    # not meet. Each call emails a fresh code AND overwrites `otp_code`, so an
    # unlimited version is both a mail-bomb aimed at the signer over our sender
    # reputation and a way to keep invalidating the code they are typing in.
    #
    # Keyed on the TOKEN rather than the IP, deliberately: the thing being
    # protected is one signer's inbox and one signer's code, and both belong to
    # the token. An IP key would let a distributed caller past it and would also
    # punish an office where several signers share an address.
    send_otp._sends = getattr(send_otp, "_sends", {})
    _rate_limit(send_otp._sends, token, limit=3, window_s=900,
                message="Too many codes requested. Wait a few minutes and try again.")

    import secrets as _secrets
    otp = f"{_secrets.randbelow(900000) + 100000}"
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)

    await pool.execute(
        "UPDATE staging.sign_signers SET otp_code=$1, otp_expires_at=$2, updated_at=NOW() WHERE id=$3",
        otp, expires, signer["id"],
    )

    from email_service import send_email
    html = _build_otp_email(signer["name"], otp, signer["title"])
    send_email(
        to_email=signer["email"],
        subject="Your signing verification code",
        html_content=html,
        purpose="signing_otp",
        ref=f"signing_otp:{signer['id']}",
    )

    client_ip = request.client.host if request.client else "unknown"

    # The open is recorded HERE, not on the GET that serves the page. Requesting
    # a code is a POST that a human deliberately triggered; nothing prefetches
    # it. `WHERE status='sent'` keeps it to the first time, so a signer who asks
    # for a second code does not produce a second opening.
    await pool.execute(
        "UPDATE staging.sign_signers SET status='opened', updated_at=NOW() "
        "WHERE id=$1 AND status='sent'",
        signer["id"],
    )
    if signer["status"] == "sent":
        await _audit(pool, signer["document_id"], signer["id"], "link_opened",
                     signer["email"], client_ip, request.headers.get("user-agent"))

    await _audit(pool, signer["document_id"], signer["id"], "otp_sent",
                 signer["email"], client_ip, None)

    return {"sent": True, "email": _mask_email(signer["email"])}


@router.post("/verify/{token}/otp/verify")
async def verify_otp(token: str, body: OTPVerify, request: Request):
    """Verify signer's OTP."""
    pool = await get_pool()

    signer = await pool.fetchrow(
        "SELECT * FROM staging.sign_signers WHERE token=$1", token,
    )
    if not signer:
        raise HTTPException(404, "Invalid signing link")
    if signer["status"] == "signed":
        raise HTTPException(400, "Already signed")

    if not signer["otp_code"] or not signer["otp_expires_at"]:
        raise HTTPException(400, "Request an OTP first")

    if datetime.now(timezone.utc) > signer["otp_expires_at"]:
        raise HTTPException(400, "OTP expired. Request a new one.")

    # ── Attempt limiting ──────────────────────────────────────────────────
    # The window has to ROLL. The previous form refreshed `first_at` only when
    # `count == 1` and never reset `count`, so after the first 15 minutes
    # elapsed the guard `count >= 5 AND elapsed < 900` could never be true
    # again — the limiter switched itself off permanently for that token and
    # allowed unlimited guesses at a 6-digit code. Starting a FRESH window once
    # the old one has expired is what makes "5 per 15 minutes" mean that on the
    # second quarter-hour as well as the first.
    #
    # Still process-local, and that is a known weakness rather than a design:
    # it is not shared across workers and it is cleared by every deploy. The
    # `otp_attempts` COLUMN is the durable home for this (the Ganit path uses
    # it — `services/esign_service.py:152`); moving it there is a schema change
    # and is reported, not made here.
    verify_otp._attempts = getattr(verify_otp, "_attempts", {})
    _rate_limit(verify_otp._attempts, f"otp_attempts:{token}", limit=5, window_s=900,
                message="Too many attempts. Request a new OTP.")

    # Constant-time. A 6-digit OTP is a 10^6 space and `!=` short-circuits at the
    # first differing digit, so failure timing narrows it a digit at a time.
    # `services/esign_service.py:140` — the Ganit signing path, same OTP, same
    # length — already uses compare_digest; this path did not.
    from utils import secret_matches

    if not secret_matches(body.otp, signer["otp_code"]):
        client_ip = request.client.host if request.client else "unknown"
        # The entered value is NOT recorded. It is a credential guess, and on a
        # mistyped digit it is very close to the real one; an audit row saying an
        # attempt failed is the fact worth keeping.
        await _audit(pool, signer["document_id"], signer["id"], "otp_failed",
                     signer["email"], client_ip, None)
        raise HTTPException(400, "Invalid OTP")

    await pool.execute(
        "UPDATE staging.sign_signers SET otp_verified=TRUE, otp_code=NULL, updated_at=NOW() WHERE id=$1",
        signer["id"],
    )

    client_ip = request.client.host if request.client else "unknown"
    await _audit(pool, signer["document_id"], signer["id"], "otp_verified",
                 signer["email"], client_ip, request.headers.get("user-agent"))

    return {"verified": True}


@router.post("/verify/{token}/sign")
async def submit_signature(token: str, body: SignatureSubmit, request: Request):
    """Submit signature after OTP verification."""
    pool = await get_pool()

    signer = await pool.fetchrow(
        "SELECT s.*, d.id as doc_id, d.signers_total, d.signers_completed, d.org_id, "
        "d.file_key, d.file_url, d.file_hash, d.status as doc_status, d.expires_at "
        "FROM staging.sign_signers s "
        "JOIN staging.sign_documents d ON d.id = s.document_id "
        "WHERE s.token=$1",
        token,
    )
    if not signer:
        raise HTTPException(404, "Invalid signing link")
    if signer["status"] == "signed":
        raise HTTPException(400, "Already signed")
    # The READ path (`get_signing_page` above) refuses a cancelled or expired
    # document; this WRITE path did not check either, so the two disagreed about
    # whether the document was still signable. The page is fetched once and can
    # sit open indefinitely — and the request can be replayed without the page at
    # all — so a signer who loaded the link before the firm cancelled it, or
    # before it expired, could still POST a signature and have it recorded as
    # valid with a full audit trail. `cancel_document` exists precisely to stop
    # signing; a withdrawal that the signing endpoint ignores is not a
    # withdrawal. Enforced here so the decision is made where the row is written.
    _doc_status_guard(signer["doc_status"], signer["expires_at"])
    if not signer["otp_verified"]:
        raise HTTPException(403, "OTP verification required before signing")

    if body.signature_type not in ("draw", "type", "upload"):
        raise HTTPException(400, "Invalid signature type")

    # The image leaves the request for R2 BEFORE any row is touched, so a
    # storage failure is a 503 the signer can retry rather than a signature
    # recorded against bytes that are not anywhere. The org comes off the
    # document row — this endpoint is public and has no org dependency to lean
    # on, the same resolution the emitters below use.
    # `doc_id` and `signer_id` are what put a signature IN its agreement's
    # folder rather than in one flat prefix holding every signature ever
    # captured — proposal 83 §3's first complaint about the old grammar, and
    # the reason "show me the files for this agreement" could only be answered
    # from the database. Both come off the row already fetched; neither costs a
    # query. Keyword-only and defaulted, so a caller that has not been threaded
    # produces a key that is merely less specific rather than one that raises.
    stored_signature = await _store_signature_image(
        body.signature_data, str(signer["org_id"]),
        doc_id=str(signer["document_id"]),
        signer_id=str(signer["id"]),
    )

    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "")
    now = datetime.now(timezone.utc)

    # The signer's row, the document's counters and the `document.signed` event
    # commit together or not at all. The signer flip carries its own
    # transition (`AND status != 'signed'`), because the "Already signed"
    # check above read the pool BEFORE this transaction: two replays of the
    # same token both passed it, both re-flipped the row idempotently, and
    # both emitted — and the counters, computed from that same stale read,
    # lost an increment when two DIFFERENT signers raced. The counter is now
    # arithmetic IN the UPDATE (signers_completed+1, status derived in SQL),
    # so each committed flip moves it exactly once whatever the interleaving.
    # `remaining_signers` is read off the document row AS WRITTEN (RETURNING
    # *), not from a re-read a concurrent signer could have moved past us.
    # The signer is an EXTERNAL party acting through a token — no product
    # user acts, so there is no actor and the event says `source='import'`;
    # the full address goes in and the emitter keeps only its domain. The
    # org comes off the document row itself: this is a public endpoint with
    # no org dependency to lean on.
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            _flipped = await _conn.fetchrow(
                "UPDATE staging.sign_signers SET "
                "status='signed', signature_data=$1, signature_type=$2, "
                "signed_at=$3, signed_ip=$4, updated_at=$3 "
                "WHERE id=$5 AND status != 'signed' "
                "RETURNING id",
                stored_signature, body.signature_type, now, client_ip, signer["id"],
            )
            if _flipped is None:
                raise HTTPException(400, "Already signed")
            _doc = await _conn.fetchrow(
                "UPDATE staging.sign_documents SET "
                "signers_completed = signers_completed + 1, "
                "status = CASE WHEN signers_completed + 1 >= signers_total "
                "              THEN 'completed' ELSE 'partially_signed' END, "
                "completed_at = CASE WHEN signers_completed + 1 >= signers_total "
                "                    THEN NOW() ELSE completed_at END, "
                "updated_at = NOW() "
                "WHERE id=$1 RETURNING *",
                signer["doc_id"],
            )
            if _doc is not None:
                await document_signed(
                    _conn,
                    org_id=str(_doc["org_id"]),
                    document_id=signer["doc_id"],
                    row=dict(_doc),
                    signer_email=signer["email"],
                    remaining_signers=_doc["signers_total"] - _doc["signers_completed"],
                    source="import",
                )
    all_signed = _doc is not None and \
        (_doc["signers_completed"] or 0) >= (_doc["signers_total"] or 0)

    await _audit(pool, signer["doc_id"], signer["id"], "signature_submitted",
                 signer["email"], client_ip, user_agent,
                 {"signature_type": body.signature_type, "ip": client_ip})

    if all_signed:
        await _audit(pool, signer["doc_id"], None, "document_completed",
                     "system", None, None, {"all_signers": signer["signers_total"]})
        # Tell the row that asked for this signature that it has one.
        #
        # A document can be raised by another module — a Ganit contract is the
        # first — and that module's own row carries the status the firm reads in
        # its list. Without this the contract stays 'pending' forever while its
        # document is executed, which is the same lie the contract module told
        # for months out of its own parallel tables.
        #
        # Swallowed and logged for the same reason as the artefacts below: the
        # signer's row is already committed and the document is already
        # complete. A failure here must not answer the signer with a 500 that
        # invites them to sign a second time. It is logged loudly because the
        # symptom is otherwise silent — a contract that never learns.
        from services.esign_service import mark_source_signed
        try:
            await mark_source_signed(pool, signer["doc_id"])
        except Exception as exc:                     # noqa: BLE001 — logged, not swallowed
            log.error("esign: could not mark the source row signed for %s: %s",
                      signer["doc_id"], exc)
        await _generate_completion_artefacts(pool, signer["doc_id"], signer["org_id"])

    return {
        "signed": True,
        # From the row AS WRITTEN — the atomic counter means the stale
        # pre-read arithmetic no longer exists to answer from.
        "document_status": _doc["status"] if _doc is not None else "partially_signed",
        "signers_completed": (_doc["signers_completed"]
                              if _doc is not None
                              else signer["signers_completed"] + 1),
        "signers_total": signer["signers_total"],
    }


@router.post("/verify/{token}/decline")
async def decline_signing(token: str, request: Request):
    """Signer declines to sign."""
    pool = await get_pool()
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}

    signer = await pool.fetchrow(
        "SELECT s.*, d.id as doc_id, d.status as doc_status, d.expires_at "
        "FROM staging.sign_signers s "
        "JOIN staging.sign_documents d ON d.id = s.document_id "
        "WHERE s.token=$1", token,
    )
    if not signer:
        raise HTTPException(404, "Invalid signing link")
    if signer["status"] == "signed":
        raise HTTPException(400, "Already signed")
    # Same gate as the sign path: a decline recorded against a cancelled or
    # expired document writes a misleading audit row ("this party refused")
    # about a document that was no longer open to anybody.
    _doc_status_guard(signer["doc_status"], signer["expires_at"])

    reason = body.get("reason", "")
    # The decline touches only the signer's row (esign.abandoned reads declines
    # off sign_signers, scoped by document), so the document row the emitter
    # carries is READ inside the same transaction the write belongs to — and
    # `sign_documents.org_id` is where this public, org-dependency-free
    # endpoint resolves its org from. External signer, no actor,
    # `source='import'`, same as document_signed; `declined_reason` is the
    # sign_signers column, carried deliberately (see the emitter's docstring).
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            # Same transition rule as the sign path: a replayed decline
            # matched the row idempotently and re-emitted. Zero rows now.
            _declined_row = await _conn.fetchrow(
                "UPDATE staging.sign_signers SET status='declined', declined_reason=$1, updated_at=NOW() "
                "WHERE id=$2 AND status NOT IN ('signed', 'declined') "
                "RETURNING id",
                reason, signer["id"],
            )
            if _declined_row is None:
                raise HTTPException(400, "This signature request is already settled")
            _doc = await _conn.fetchrow(
                "SELECT * FROM staging.sign_documents WHERE id=$1", signer["doc_id"],
            )
            if _doc is not None:
                await document_declined(
                    _conn,
                    org_id=str(_doc["org_id"]),
                    document_id=signer["doc_id"],
                    row=dict(_doc),
                    declined_reason=reason,
                    source="import",
                )

    client_ip = request.client.host if request.client else "unknown"
    await _audit(pool, signer["doc_id"], signer["id"], "signature_declined",
                 signer["email"], client_ip, None, {"reason": reason})

    return {"declined": True}


# ── Cancel / resend ──────────────────────────────────────────

@router.post("/documents/{doc_id}/cancel")
async def cancel_document(
    doc_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    pool = await get_pool()
    doc = await _doc_for_reader(pool, doc_id, org_id, user["user_id"])
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc["status"] in ("completed", "cancelled"):
        raise HTTPException(400, f"Cannot cancel a {doc['status']} document")

    await pool.execute(
        "UPDATE staging.sign_documents SET status='cancelled', updated_at=NOW() WHERE id=$1",
        uuid.UUID(doc_id),
    )
    await _audit(pool, uuid.UUID(doc_id), None, "document_cancelled", user["user_id"], None, None)

    return {"status": "cancelled"}


@router.post("/documents/{doc_id}/resend/{signer_id}")
async def resend_to_signer(
    doc_id: str,
    signer_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    pool = await get_pool()
    doc = await _doc_for_reader(pool, doc_id, org_id, user["user_id"])
    if not doc:
        raise HTTPException(404, "Document not found")

    signer = await pool.fetchrow(
        "SELECT * FROM staging.sign_signers WHERE id=$1::uuid AND document_id=$2::uuid",
        uuid.UUID(signer_id), uuid.UUID(doc_id),
    )
    if not signer:
        raise HTTPException(404, "Signer not found")
    if signer["status"] == "signed":
        raise HTTPException(400, "Signer has already signed")

    from email_service import send_email
    sign_url = f"{FRONTEND_URL}/sign/{signer['token']}"
    html = _build_signing_email(doc["title"], signer["name"], sign_url, doc.get("description", ""))
    send_email(
        to_email=signer["email"],
        subject=f"Reminder: Please sign — {doc['title']}",
        html_content=html,
        purpose="signature_reminder",
        ref=f"signature_reminder:{signer_id}",
    )

    await _audit(pool, uuid.UUID(doc_id), uuid.UUID(signer_id), "reminder_sent",
                 user["user_id"], None, None)

    return {"resent": True}


@router.post("/documents/{doc_id}/rebuild")
async def rebuild_signed_document(
    doc_id: str,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    """Produce the executed PDF for a document that completed without one.

    Every document completed before the signed-PDF pipeline existed has a
    signature trail in the database and its original file in storage, so the
    executed copy can still be assembled — nothing about it is guessed. This
    endpoint is that path, and it is also the recovery path when generation
    failed at completion time (WeasyPrint down, storage timeout).

    Refused on anything not completed: a signature page for a document that is
    still collecting signatures would be a half-executed contract, and would be
    indistinguishable from a finished one once downloaded.

    Rebuilding is idempotent in effect but not in bytes — it writes a NEW object
    and repoints the row. The old object is left in place rather than deleted,
    because a superseded executed copy may already have been sent to a
    counterparty and a dangling link is worse than an orphan file.
    """
    pool = await get_pool()
    doc = await pool.fetchrow(
        "SELECT id, status, file_key FROM staging.sign_documents "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        uuid.UUID(doc_id), org_id,
    )
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc["status"] != "completed":
        raise HTTPException(
            409,
            "Only a completed document has an executed copy. This one is "
            f"{doc['status'].replace('_', ' ')} — it is still collecting signatures.",
        )
    if not doc["file_key"] or doc["file_key"] == "pending":
        raise HTTPException(409, "The file presented for signature is no longer in storage, "
                                 "so the executed copy cannot be assembled.")

    try:
        result = await _generate_signed_pdf(pool, uuid.UUID(doc_id), org_id)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        log.error("esign rebuild failed for %s: %s", doc_id, exc)
        raise HTTPException(500, "Could not assemble the executed copy.") from exc

    await _audit(pool, uuid.UUID(doc_id), None, "signed_copy_rebuilt",
                 user["user_id"], request.client.host if request.client else None, None,
                 result or {})

    row = await pool.fetchrow(
        "SELECT signed_file_key, signed_file_url, signed_file_hash "
        "FROM staging.sign_documents WHERE id=$1::uuid", uuid.UUID(doc_id),
    )
    out = await _refresh_artefact_urls(org_id, dict(row))
    out["appended_original"] = (result or {}).get("appended_original", False)
    return out


@router.get("/documents/{doc_id}/audit")
async def get_audit_trail(
    doc_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    pool = await get_pool()
    # Gated like every other by-id read. An audit trail is the signing evidence
    # for the document, so leaking it leaks who is circulating which contract to
    # whom — the same crossing, one table further along.
    doc = await _doc_for_reader(pool, doc_id, org_id, user["user_id"])
    if not doc:
        raise HTTPException(404, "Document not found")

    rows = await pool.fetch(
        "SELECT a.*, s.name as signer_name, s.email as signer_email "
        "FROM staging.sign_audit_log a "
        "LEFT JOIN staging.sign_signers s ON s.id = a.signer_id "
        "WHERE a.document_id=$1 ORDER BY a.created_at",
        uuid.UUID(doc_id),
    )
    return {"audit_trail": [dict(r) for r in rows]}


# ── Completion artefacts ─────────────────────────────────────
#
# Completing a document produces TWO things, and for a long time it produced
# only the second one under the first one's name:
#
#   1. The executed PDF — the original pages, unaltered, followed by a signature
#      page naming each signatory with their signature, time, IP and
#      verification method. This is the document. It lives in signed_file_*.
#   2. A JSON certificate carrying the machine-readable audit trail. Useful, but
#      it is evidence ABOUT the document, not the document. It lives in
#      certificate_file_*.
#
# Neither is allowed to fail the signature itself: by the time this runs the
# signer's row is already committed and the document is already complete. A
# WeasyPrint outage must not turn a valid signature into a 500 that invites the
# signer to sign again — so `_generate_completion_artefacts` swallows and logs,
# and `POST /documents/{id}/rebuild` exists to produce the artefacts later.


async def _generate_signed_certificate(pool, doc_id, org_id: str):
    """Build and store the JSON audit certificate."""
    doc = await pool.fetchrow("SELECT * FROM staging.sign_documents WHERE id=$1", doc_id)
    signers = await pool.fetch(
        "SELECT * FROM staging.sign_signers WHERE document_id=$1 ORDER BY sign_order", doc_id,
    )
    audit = await pool.fetch(
        "SELECT * FROM staging.sign_audit_log WHERE document_id=$1 ORDER BY created_at", doc_id,
    )

    cert_data = {
        "document_id": str(doc_id),
        "title": doc["title"],
        "original_file_hash": doc["file_hash"],
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "signers": [
            {
                "name": s["name"],
                "email": s["email"],
                "signed_at": s["signed_at"].isoformat() if s["signed_at"] else None,
                "signed_ip": s["signed_ip"],
                "signature_type": s["signature_type"],
                "otp_verified": s["otp_verified"],
            }
            for s in signers
        ],
        "audit_trail": [
            {
                "action": a["action"],
                "actor": a["actor_email"],
                "ip": a["actor_ip"],
                "timestamp": a["created_at"].isoformat(),
            }
            for a in audit
        ],
    }

    cert_json = json.dumps(cert_data, indent=2)
    cert_hash = hashlib.sha256(cert_json.encode()).hexdigest()

    cert_bytes = cert_json.encode()
    # No acting user, and that is the truth rather than a gap: a completion
    # certificate is minted by the product when the last signer finishes, not
    # by a person. `user_id=""` leaves the segment out; `"system"` would have
    # rendered a folder named after an account that does not exist.
    upload_result = await upload_file(
        file_bytes=cert_bytes,
        filename=f"certificate-{str(doc_id)[:8]}.json",
        content_type="application/json",
        user_id="",
        module="esign",
        scope=[str(doc_id), "certificate"],
        org_id=org_id,
    )

    await pool.execute(
        "UPDATE staging.sign_documents SET certificate_file_key=$1, certificate_file_url=$2, "
        "certificate_hash=$3, updated_at=NOW() WHERE id=$4",
        upload_result.get("key", ""), upload_result["url"], cert_hash, doc_id,
    )


async def _generate_signed_pdf(pool, doc_id, org_id: str):
    """Build and store the executed PDF — the original pages plus a signature page."""
    from services.esign_signed_doc import build_signed_pdf
    from services.storage import download_file

    doc = await pool.fetchrow("SELECT * FROM staging.sign_documents WHERE id=$1", doc_id)
    if not doc:
        return
    signers = [dict(s) for s in await pool.fetch(
        "SELECT * FROM staging.sign_signers WHERE document_id=$1 ORDER BY sign_order", doc_id,
    )]
    # The stored signatures come back inline for the render and for nothing
    # else — `build_signed_pdf` is synchronous and has neither a pool nor a
    # loop, and the shape it receives is the shape it has always received.
    for s in signers:
        s["signature_data"] = await _signature_for_render(s.get("signature_data"), org_id)
    org = await pool.fetchrow(
        "SELECT name, gstin, pan, logo_url, billing_address, email, phone, website "
        "FROM staging.organisations WHERE id=$1::uuid", org_id,
    )

    original = await download_file(doc["file_key"], org_id, doc["file_url"])

    # Off the event loop. `build_signed_pdf` renders with WeasyPrint and then
    # merges with pypdf — both CPU-bound and synchronous — and with
    # WEB_CONCURRENCY=1 that blocked every other request in the worker for the
    # whole render. `to_thread` forwards kwargs, so the call keeps its keyword.
    pdf_bytes, appended = await asyncio.to_thread(
        build_signed_pdf,
        dict(org) if org else {}, dict(doc), signers, original,
        original_name=(doc["file_key"] or "").rsplit("/", 1)[-1],
    )
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

    # Same: the executed document is produced by the product, not by a person.
    upload_result = await upload_file(
        file_bytes=pdf_bytes,
        filename=f"signed-{str(doc_id)[:8]}.pdf",
        content_type="application/pdf",
        user_id="",
        module="esign",
        scope=[str(doc_id), "signed"],
        org_id=org_id,
    )

    await pool.execute(
        "UPDATE staging.sign_documents SET signed_file_key=$1, signed_file_url=$2, "
        "signed_file_hash=$3, updated_at=NOW() WHERE id=$4",
        upload_result.get("key", ""), upload_result["url"], pdf_hash, doc_id,
    )
    if not appended:
        log.warning("esign: signed PDF for %s carries the signature page only — "
                    "the original could not be appended", doc_id)
    return {"appended_original": appended, "size": len(pdf_bytes)}


async def _generate_completion_artefacts(pool, doc_id, org_id: str):
    """Both artefacts, neither allowed to break the signature that triggered them."""
    try:
        await _generate_signed_certificate(pool, doc_id, org_id)
    except Exception as exc:
        log.error("esign: certificate generation failed for %s: %s", doc_id, exc)
    try:
        await _generate_signed_pdf(pool, doc_id, org_id)
    except Exception as exc:
        log.error("esign: signed PDF generation failed for %s: %s", doc_id, exc)


# ── Helpers ──────────────────────────────────────────────────

async def _audit(pool, doc_id, signer_id, action, actor_email, actor_ip, user_agent, details=None):
    await pool.execute(
        "INSERT INTO staging.sign_audit_log "
        "(document_id, signer_id, action, actor_email, actor_ip, actor_user_agent, details) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
        doc_id, signer_id, action, actor_email, actor_ip, user_agent,
        json.dumps(details) if details else "{}",
    )


def _mask_email(email: str) -> str:
    parts = email.split("@")
    if len(parts) != 2:
        return "***"
    name = parts[0]
    masked = name[0] + "***" + name[-1] if len(name) > 2 else "***"
    return f"{masked}@{parts[1]}"


def _build_signing_email(doc_title: str, signer_name: str, sign_url: str, description: str) -> str:
    """Signature request, on the shared editorial email shell.

    Was a standalone <div> with its own blue header, `#e5e7eb` borders and a
    560px max-width — none of which appear in any token file. It also dropped
    `sign_url` into an href unescaped; the token is generated server-side so it
    was not exploitable, but a URL in an attribute is exactly the position that
    needs escaping least conditionally.
    """
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.join(_o.path.dirname(__file__), ".."))
    from email_service import _base, _body_text, _info_card, _cta_row, _fallback_url
    from html import escape as _h

    body = (
        _body_text(f'Hi <strong>{_h(str(signer_name).split()[0] if signer_name else "there")}</strong>, '
                   f'you have been asked to review and sign a document.')
        + _info_card([("DOCUMENT", str(doc_title)), ("ACTION", "Review & sign")])
        + (_body_text(_h(str(description))) if description else "")
        + _cta_row(sign_url, "Review & sign document", "primary")
        + _body_text('You will be asked to verify your identity with a one-time code before '
                     'signing. If you did not expect this request, you can safely ignore it.')
        + _fallback_url(sign_url)
    )
    return _base(
        preheader=f"You have been asked to sign: {doc_title}",
        kicker="SIGNATURE REQUESTED · हस्ताक्षर",
        headline="A document needs your signature",
        sanskrit="हस्ताक्षर अनुरोध",
        lede="",
        body_rows=body,
        footer_note="You are receiving this because somebody asked you to sign a document "
                    "through Kartavaya. This message is transactional.",
    )


def _build_otp_email(signer_name: str, otp: str, doc_title: str) -> str:
    """One-time signing code, on the shared editorial email shell.

    The code is rendered without letter-spacing on the digits' container being
    inherited by anything else, and never appears in the preheader — preview text
    is shown on a locked phone screen, so putting the code there would defeat the
    second factor.
    """
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.join(_o.path.dirname(__file__), ".."))
    from email_service import _base, _body_text, _cta_row  # noqa: F401
    from email_tokens import FONT_MONO, INK, CARD_BG, INK_3, FONT_UI
    from html import escape as _h

    code = (
        f'<tr><td class="em__pad" style="padding:20px 32px 0;">'
        f'<table role="presentation" class="em__card" width="100%" cellpadding="0" '
        f'cellspacing="0" border="0" style="background:{CARD_BG};border-radius:10px;">'
        f'<tr><td align="center" style="padding:22px 16px;">'
        f'<div class="em__ink3" style="font-family:{FONT_UI};font-size:9px;font-weight:600;'
        f'letter-spacing:1.8px;text-transform:uppercase;color:{INK_3};padding-bottom:10px;">'
        f'Your verification code</div>'
        f'<div class="em__ink" style="font-family:{FONT_MONO};font-size:34px;font-weight:700;'
        f'letter-spacing:9px;color:{INK};line-height:1.1;">{_h(str(otp))}</div>'
        f'</td></tr></table></td></tr>'
    )
    body = (
        _body_text(f'Hi <strong>{_h(str(signer_name).split()[0] if signer_name else "there")}</strong>, '
                   f'use this code to verify your identity and sign '
                   f'<strong>{_h(str(doc_title))}</strong>.')
        + code
        + _body_text('This code expires in <strong>10 minutes</strong> and works once. '
                     'Nobody from Aekam will ever ask you for it.')
    )
    return _base(
        # Deliberately does not contain the code: preview text renders on a
        # locked screen, and a second factor visible without unlocking is not one.
        preheader="Your signing verification code is inside.",
        kicker="VERIFICATION · सत्यापन",
        headline="Your verification code",
        sanskrit="सत्यापन संकेत",
        lede="",
        body_rows=body,
        footer_note="You are receiving this because you are signing a document through "
                    "Kartavaya. This message is transactional.",
    )
