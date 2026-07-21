"""
esign.py — In-house e-signature module.

Flow: Upload PDF → Add signers → Send → Signer opens link → OTP verify → Sign → Done
Legal basis: IT Act §10A — e-contracts valid, no prescribed signature form.
Audit trail proves: (1) signature links to signatory (OTP), (2) signatory control,
(3) alterations detectable (SHA-256), (4) Contract Act essentials met.
"""
import hashlib
import json
import logging
import os
import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services.storage import upload_file

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/esign", tags=["esign"])

_esign_gate = require_module("esign")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://kartavya.com")

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
    signature_data: str
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
    q = "SELECT * FROM staging.sign_documents WHERE org_id=$1::uuid"
    args = [org_id]
    if status:
        q += " AND status=$2"
        args.append(status)
    q += " ORDER BY created_at DESC LIMIT 50"
    rows = await pool.fetch(q, *args)
    return {"data": [dict(r) for r in rows]}


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

    doc = await pool.fetchrow(
        "SELECT * FROM staging.sign_documents WHERE id=$1::uuid AND org_id=$2::uuid",
        uuid.UUID(doc_id), org_id,
    )
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
        file_bytes = await file.read()
        filename = file.filename or "document.pdf"
    else:
        file_bytes = await request.body()
        filename = "document.pdf"

    if len(file_bytes) > 20 * 1024 * 1024:
        raise HTTPException(400, "File too large. Max 20MB.")

    file_hash = hashlib.sha256(file_bytes).hexdigest()

    upload_result = await upload_file(
        file_bytes=file_bytes,
        filename=filename,
        content_type="application/pdf",
        user_id=user["user_id"],
        folder="esign/originals",
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
    doc = await pool.fetchrow(
        "SELECT * FROM staging.sign_documents WHERE id=$1::uuid AND org_id=$2::uuid",
        uuid.UUID(doc_id), org_id,
    )
    if not doc:
        raise HTTPException(404, "Document not found")

    signers = await pool.fetch(
        "SELECT id, name, email, phone, sign_order, status, signed_at, signature_type "
        "FROM staging.sign_signers WHERE document_id=$1 ORDER BY sign_order",
        uuid.UUID(doc_id),
    )

    audit = await pool.fetch(
        "SELECT action, actor_email, details, created_at "
        "FROM staging.sign_audit_log WHERE document_id=$1 ORDER BY created_at",
        uuid.UUID(doc_id),
    )

    return {
        "document": dict(doc),
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

    doc = await pool.fetchrow(
        "SELECT * FROM staging.sign_documents WHERE id=$1::uuid AND org_id=$2::uuid",
        uuid.UUID(doc_id), org_id,
    )
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
            )
            await pool.execute(
                "UPDATE staging.sign_signers SET status='sent', updated_at=NOW() WHERE id=$1",
                signer["id"],
            )
        except Exception as e:
            log.error("Failed to send signing email to %s: %s", signer["email"], e)

    await pool.execute(
        "UPDATE staging.sign_documents SET status='sent', updated_at=NOW() WHERE id=$1",
        uuid.UUID(doc_id),
    )

    await _audit(pool, uuid.UUID(doc_id), None, "document_sent", user["user_id"], None, None,
                 {"signers_count": len(signers)})

    return {"status": "sent", "signers_notified": len(signers)}


# ── Public signing endpoints (no auth — token-based) ─────────

@router.get("/verify/{token}")
async def get_signing_page(token: str, request: Request):
    """Public endpoint — signer opens their signing link."""
    pool = await get_pool()

    signer = await pool.fetchrow(
        "SELECT s.*, d.title, d.description, d.file_url, d.file_hash, d.status as doc_status, "
        "d.expires_at, d.org_id "
        "FROM staging.sign_signers s "
        "JOIN staging.sign_documents d ON d.id = s.document_id "
        "WHERE s.token=$1",
        token,
    )
    if not signer:
        raise HTTPException(404, "Invalid signing link")

    if signer["doc_status"] in ("cancelled", "expired"):
        raise HTTPException(410, "This document has been cancelled or expired")

    if signer["expires_at"] and signer["expires_at"] < datetime.now(timezone.utc):
        await pool.execute(
            "UPDATE staging.sign_documents SET status='expired' WHERE id=$1",
            signer["document_id"],
        )
        raise HTTPException(410, "This signing link has expired")

    if signer["status"] == "signed":
        return {"status": "already_signed", "signed_at": signer["signed_at"]}

    await pool.execute(
        "UPDATE staging.sign_signers SET status='opened', updated_at=NOW() WHERE id=$1 AND status='sent'",
        signer["id"],
    )

    client_ip = request.client.host if request.client else "unknown"
    await _audit(pool, signer["document_id"], signer["id"], "link_opened",
                 signer["email"], client_ip, request.headers.get("user-agent"))

    return {
        "status": "pending",
        "document_title": signer["title"],
        "document_description": signer["description"],
        "file_url": signer["file_url"],
        "signer_name": signer["name"],
        "signer_email": signer["email"],
        "otp_required": not signer["otp_verified"],
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
    )

    client_ip = request.client.host if request.client else "unknown"
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

    otp_attempts_key = f"otp_attempts:{token}"
    attempts = getattr(verify_otp, '_attempts', {})
    if not hasattr(verify_otp, '_attempts'):
        verify_otp._attempts = attempts
    current = attempts.get(otp_attempts_key, {"count": 0, "first_at": datetime.now(timezone.utc)})
    if current["count"] >= 5 and (datetime.now(timezone.utc) - current["first_at"]).total_seconds() < 900:
        raise HTTPException(429, "Too many attempts. Request a new OTP.")
    current["count"] = current["count"] + 1
    if current["count"] == 1:
        current["first_at"] = datetime.now(timezone.utc)
    attempts[otp_attempts_key] = current

    if body.otp != signer["otp_code"]:
        client_ip = request.client.host if request.client else "unknown"
        await _audit(pool, signer["document_id"], signer["id"], "otp_failed",
                     signer["email"], client_ip, None, {"entered": body.otp})
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
        "d.file_key, d.file_url, d.file_hash "
        "FROM staging.sign_signers s "
        "JOIN staging.sign_documents d ON d.id = s.document_id "
        "WHERE s.token=$1",
        token,
    )
    if not signer:
        raise HTTPException(404, "Invalid signing link")
    if signer["status"] == "signed":
        raise HTTPException(400, "Already signed")
    if not signer["otp_verified"]:
        raise HTTPException(403, "OTP verification required before signing")

    if body.signature_type not in ("draw", "type", "upload"):
        raise HTTPException(400, "Invalid signature type")

    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "")
    now = datetime.now(timezone.utc)

    await pool.execute(
        "UPDATE staging.sign_signers SET "
        "status='signed', signature_data=$1, signature_type=$2, "
        "signed_at=$3, signed_ip=$4, updated_at=$3 "
        "WHERE id=$5",
        body.signature_data, body.signature_type, now, client_ip, signer["id"],
    )

    new_completed = signer["signers_completed"] + 1
    all_signed = new_completed >= signer["signers_total"]

    new_status = "completed" if all_signed else "partially_signed"
    update_q = (
        "UPDATE staging.sign_documents SET signers_completed=$1, status=$2, updated_at=NOW()"
    )
    args = [new_completed, new_status]
    if all_signed:
        update_q += ", completed_at=NOW()"
    update_q += " WHERE id=$3"
    args.append(signer["doc_id"])
    await pool.execute(update_q, *args)

    await _audit(pool, signer["doc_id"], signer["id"], "signature_submitted",
                 signer["email"], client_ip, user_agent,
                 {"signature_type": body.signature_type, "ip": client_ip})

    if all_signed:
        await _audit(pool, signer["doc_id"], None, "document_completed",
                     "system", None, None, {"all_signers": signer["signers_total"]})
        await _generate_signed_certificate(pool, signer["doc_id"], signer["org_id"])

    return {
        "signed": True,
        "document_status": new_status,
        "signers_completed": new_completed,
        "signers_total": signer["signers_total"],
    }


@router.post("/verify/{token}/decline")
async def decline_signing(token: str, request: Request):
    """Signer declines to sign."""
    pool = await get_pool()
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}

    signer = await pool.fetchrow(
        "SELECT s.*, d.id as doc_id FROM staging.sign_signers s "
        "JOIN staging.sign_documents d ON d.id = s.document_id "
        "WHERE s.token=$1", token,
    )
    if not signer:
        raise HTTPException(404, "Invalid signing link")
    if signer["status"] == "signed":
        raise HTTPException(400, "Already signed")

    reason = body.get("reason", "")
    await pool.execute(
        "UPDATE staging.sign_signers SET status='declined', declined_reason=$1, updated_at=NOW() WHERE id=$2",
        reason, signer["id"],
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
    doc = await pool.fetchrow(
        "SELECT * FROM staging.sign_documents WHERE id=$1::uuid AND org_id=$2::uuid",
        uuid.UUID(doc_id), org_id,
    )
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
    doc = await pool.fetchrow(
        "SELECT * FROM staging.sign_documents WHERE id=$1::uuid AND org_id=$2::uuid",
        uuid.UUID(doc_id), org_id,
    )
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
    )

    await _audit(pool, uuid.UUID(doc_id), uuid.UUID(signer_id), "reminder_sent",
                 user["user_id"], None, None)

    return {"resent": True}


@router.get("/documents/{doc_id}/audit")
async def get_audit_trail(
    doc_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(_esign_gate),
):
    pool = await get_pool()
    doc = await pool.fetchrow(
        "SELECT id FROM staging.sign_documents WHERE id=$1::uuid AND org_id=$2::uuid",
        uuid.UUID(doc_id), org_id,
    )
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


# ── Signed certificate generation ────────────────────────────

async def _generate_signed_certificate(pool, doc_id, org_id: str):
    """Generate a signing certificate with SHA-256 hash and audit trail."""
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
    upload_result = await upload_file(
        file_bytes=cert_bytes,
        filename=f"certificate-{str(doc_id)[:8]}.json",
        content_type="application/json",
        user_id="system",
        folder="esign/certificates",
        org_id=org_id,
    )

    await pool.execute(
        "UPDATE staging.sign_documents SET signed_file_key=$1, signed_file_url=$2, "
        "signed_file_hash=$3, updated_at=NOW() WHERE id=$4",
        upload_result.get("key", ""), upload_result["url"], cert_hash, doc_id,
    )


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
    from html import escape as _h
    return f"""
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #0082c6; padding: 24px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Document Signing Request</h1>
      </div>
      <div style="padding: 32px; background: #fff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 15px; color: #333;">Hi {_h(signer_name)},</p>
        <p style="font-size: 15px; color: #333;">
          You have been requested to sign: <strong>{_h(doc_title)}</strong>
        </p>
        {f'<p style="font-size: 14px; color: #666;">{_h(description)}</p>' if description else ''}
        <div style="text-align: center; margin: 32px 0;">
          <a href="{sign_url}" style="background: #0082c6; color: #fff; padding: 14px 40px;
             border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;
             display: inline-block;">
            Review &amp; Sign Document
          </a>
        </div>
        <p style="font-size: 12px; color: #999;">
          You will need to verify your identity via OTP before signing.
          If you did not expect this request, you can safely ignore this email.
        </p>
      </div>
      <p style="font-size: 11px; color: #999; text-align: center; margin-top: 16px;">
        Powered by Kartavaya · Aekam Inc
      </p>
    </div>
    """


def _build_otp_email(signer_name: str, otp: str, doc_title: str) -> str:
    from html import escape as _h
    return f"""
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #0082c6; padding: 24px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px;">Verification Code</h1>
      </div>
      <div style="padding: 32px; background: #fff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 15px; color: #333;">Hi {_h(signer_name)},</p>
        <p style="font-size: 15px; color: #333;">
          Your verification code for signing <strong>{_h(doc_title)}</strong> is:
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #0082c6;
                 background: #f0f7ff; padding: 16px 32px; border-radius: 12px; display: inline-block;">
            {otp}
          </span>
        </div>
        <p style="font-size: 13px; color: #666;">
          This code expires in 10 minutes. Do not share it with anyone.
        </p>
      </div>
    </div>
    """
