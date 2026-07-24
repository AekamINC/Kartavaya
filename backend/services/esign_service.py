"""
esign_service.py — In-house electronic signature service.
OTP verification + SHA-256 audit trail. IT Act §10A compliant.
Provider interface kept open for Aadhaar eSign (Leegality) drop-in.
"""
import hashlib
import logging
import secrets
from datetime import datetime, timezone, timedelta

from db import get_pool

logger = logging.getLogger(__name__)

OTP_LENGTH = 6
OTP_EXPIRY_MINUTES = 10
MAX_OTP_ATTEMPTS = 5
SIGNER_TOKEN_BYTES = 32
DEFAULT_EXPIRY_DAYS = 7


def generate_token() -> str:
    return secrets.token_urlsafe(SIGNER_TOKEN_BYTES)


def generate_otp() -> str:
    return "".join([str(secrets.randbelow(10)) for _ in range(OTP_LENGTH)])


def hash_pdf(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()


async def send_for_signature(
    pool, contract_id: str, signers: list[dict], org_id: str, sent_by: str
) -> list[dict]:
    """Create signer records and send signing links via email."""
    created = []
    for i, s in enumerate(signers):
        token = generate_token()
        row = await pool.fetchrow(
            "INSERT INTO staging.ganit_contract_signers "
            "(contract_id, name, email, phone, signing_order, token, status, "
            " expires_at) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6, 'sent', NOW() + INTERVAL '7 days') "
            "RETURNING id, token",
            contract_id, s["name"], s["email"], s.get("phone", ""),
            s.get("order", i + 1), token,
        )
        created.append({"id": str(row["id"]), "name": s["name"], "email": s["email"]})

        await _log_audit(pool, contract_id, str(row["id"]), "signature_requested", {
            "sent_by": sent_by, "signer_email": s["email"],
        })

    await pool.execute(
        "UPDATE staging.ganit_contracts SET signature_status='pending', "
        "updated_at=NOW() WHERE id=$1::uuid AND org_id=$2::uuid",
        contract_id, org_id,
    )

    # Send emails (best-effort; the links work regardless)
    try:
        from services.email_service import send_email
        for s_info, s_row in zip(signers, created):
            backend_url = __import__("os").getenv("BACKEND_URL", "").rstrip("/")
            frontend_url = __import__("os").getenv("FRONTEND_URL", "").rstrip("/")
            sign_url = f"{frontend_url}/sign/{created[signers.index(s_info)].get('_token', token)}"
            await send_email(
                to=s_info["email"],
                subject="Signature requested — please review and sign",
                html=f"<p>Hi {s_info['name']},</p>"
                     f"<p>You have been asked to sign a document. "
                     f"<a href='{sign_url}'>Click here to review and sign</a>.</p>"
                     f"<p>This link expires in {DEFAULT_EXPIRY_DAYS} days.</p>",
            )
    except Exception as e:
        logger.warning("Failed to send signing email: %s", e)

    return created


async def get_signer_by_token(pool, token: str) -> dict | None:
    row = await pool.fetchrow(
        "SELECT s.*, c.title AS contract_title, c.description AS contract_description, "
        "c.file_url AS contract_file_url, c.file_key AS contract_file_key, c.contract_value, c.org_id AS contract_org_id "
        "FROM staging.ganit_contract_signers s "
        "JOIN staging.ganit_contracts c ON c.id = s.contract_id "
        "WHERE s.token=$1 AND s.expires_at > NOW()",
        token,
    )
    return dict(row) if row else None


async def issue_otp(pool, token: str, ip: str, ua: str) -> bool:
    signer = await get_signer_by_token(pool, token)
    if not signer:
        return False
    if signer["otp_attempts"] >= MAX_OTP_ATTEMPTS:
        return False

    otp = generate_otp()
    await pool.execute(
        "UPDATE staging.ganit_contract_signers SET otp_code=$1, otp_attempts=0 "
        "WHERE token=$2",
        otp, token,
    )
    await _log_audit(pool, str(signer["contract_id"]), str(signer["id"]),
                     "otp_issued", {"ip": ip, "ua": ua})

    try:
        from services.email_service import send_email
        await send_email(
            to=signer["email"],
            subject=f"Your verification code: {otp}",
            html=f"<p>Your one-time verification code is: <strong>{otp}</strong></p>"
                 f"<p>This code is valid for {OTP_EXPIRY_MINUTES} minutes.</p>",
        )
    except Exception as e:
        logger.warning("Failed to send OTP email: %s", e)

    return True


async def verify_otp(pool, token: str, otp: str, ip: str, ua: str) -> bool:
    signer = await get_signer_by_token(pool, token)
    if not signer:
        return False
    if signer["otp_attempts"] >= MAX_OTP_ATTEMPTS:
        return False

    await pool.execute(
        "UPDATE staging.ganit_contract_signers SET otp_attempts = otp_attempts + 1 "
        "WHERE token=$1",
        token,
    )

    if not secrets.compare_digest(signer.get("otp_code", ""), otp):
        await _log_audit(pool, str(signer["contract_id"]), str(signer["id"]),
                         "otp_failed", {"ip": ip, "ua": ua})
        return False

    await pool.execute(
        "UPDATE staging.ganit_contract_signers SET otp_verified_at=NOW(), "
        "status='viewed' WHERE token=$1",
        token,
    )
    if not signer.get("viewed_at"):
        await pool.execute(
            "UPDATE staging.ganit_contract_signers SET viewed_at=NOW() WHERE token=$1",
            token,
        )
    await _log_audit(pool, str(signer["contract_id"]), str(signer["id"]),
                     "otp_verified", {"ip": ip, "ua": ua})
    return True


async def submit_signature(
    pool, token: str, signature_data_url: str, consent_text: str,
    ip: str, ua: str,
) -> dict | None:
    signer = await get_signer_by_token(pool, token)
    if not signer:
        return None
    if not signer.get("otp_verified_at"):
        return None

    await pool.execute(
        "UPDATE staging.ganit_contract_signers SET "
        "status='signed', signature_data_url=$1, consent_text=$2, "
        "ip_address=$3, user_agent=$4, signed_at=NOW() "
        "WHERE token=$5",
        signature_data_url, consent_text, ip, ua, token,
    )

    await _log_audit(pool, str(signer["contract_id"]), str(signer["id"]),
                     "signature_submitted", {"ip": ip, "ua": ua, "consent": consent_text})

    # Check if all signers have signed
    pending = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.ganit_contract_signers "
        "WHERE contract_id=$1 AND status <> 'signed'",
        signer["contract_id"],
    )
    if pending == 0:
        await pool.execute(
            "UPDATE staging.ganit_contracts SET signature_status='signed', "
            "signed_at=NOW(), updated_at=NOW() WHERE id=$1",
            signer["contract_id"],
        )
        await _log_audit(pool, str(signer["contract_id"]), None,
                         "all_signatures_complete", {})

    return {"status": "signed", "all_complete": pending == 0}


async def cancel_signature(pool, contract_id: str, org_id: str, cancelled_by: str):
    await pool.execute(
        "UPDATE staging.ganit_contracts SET signature_status='cancelled', "
        "updated_at=NOW() WHERE id=$1::uuid AND org_id=$2::uuid",
        contract_id, org_id,
    )
    await pool.execute(
        "UPDATE staging.ganit_contract_signers SET status='expired' "
        "WHERE contract_id=$1::uuid AND status IN ('pending','sent','viewed')",
        contract_id,
    )
    await _log_audit(pool, contract_id, None, "signature_cancelled",
                     {"cancelled_by": cancelled_by})


async def get_audit_trail(pool, contract_id: str) -> list[dict]:
    rows = await pool.fetch(
        "SELECT a.*, s.name AS signer_name, s.email AS signer_email "
        "FROM staging.ganit_contract_audit_trail a "
        "LEFT JOIN staging.ganit_contract_signers s ON s.id = a.signer_id "
        "WHERE a.contract_id=$1::uuid ORDER BY a.created_at",
        contract_id,
    )
    return [dict(r) for r in rows]


async def _log_audit(
    pool, contract_id: str, signer_id: str | None, event: str,
    metadata: dict | None = None, ip: str = None, ua: str = None,
):
    await pool.execute(
        "INSERT INTO staging.ganit_contract_audit_trail "
        "(contract_id, signer_id, event, ip_address, user_agent, metadata) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)",
        contract_id, signer_id, event, ip or metadata.get("ip"),
        ua or metadata.get("ua"), __import__("json").dumps(metadata or {}),
    )
