"""
esign_service.py — In-house electronic signature service.
OTP verification + SHA-256 audit trail. IT Act §10A compliant.
Provider interface kept open for Aadhaar eSign (Leegality) drop-in.
"""
import hashlib
import html
import logging
import os
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException

from db import get_pool
# Root module, NOT `services.email_service` — that path does not exist and the
# import error was being swallowed by a bare `except Exception`. Imported at
# module scope so a wrong path fails at startup rather than silently at send.
from email_service import send_email

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
) -> tuple[list[dict], list[str]]:
    """Create signer records and email each one its own signing link.

    Returns `(created, failed_emails)`. The second element exists because this
    used to report success unconditionally: every send raised, the exception was
    swallowed, and the endpoint answered `{"status": "sent"}`. A firm that
    believes an engagement letter went out does not chase it.
    """
    created = []
    # (email, name, token) per signer, kept LOCAL. The token must never enter
    # `created`: the caller returns it verbatim as the HTTP body
    # (`routers/ganit.py:1282` — `{"status": "sent", "signers": result}`), so a
    # token there would hand every signer's signing link to whoever posted the
    # request. That is the whole authority to sign, in a response body.
    outbox: list[tuple[str, str, str]] = []
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
        outbox.append((s["email"], s["name"], row["token"]))

        await _log_audit(pool, contract_id, str(row["id"]), "signature_requested", {
            "sent_by": sent_by, "signer_email": s["email"],
        })

    await pool.execute(
        "UPDATE staging.ganit_contracts SET signature_status='pending', "
        "updated_at=NOW() WHERE id=$1::uuid AND org_id=$2::uuid",
        contract_id, org_id,
    )

    # ── Sending, and why this block was rewritten rather than patched ─────────
    # Four independent faults sat here, and one `except Exception` hid all four,
    # so the endpoint answered `{"status": "sent"}` while nothing was ever sent:
    #
    #   1. `from services.email_service import send_email` — that module does not
    #      exist. `email_service` is at the backend ROOT. ModuleNotFoundError.
    #   2. `await send_email(...)` — `send_email` is SYNCHRONOUS
    #      (`email_service.py:435`) and returns bool, so the await raises.
    #   3. `to=` / `html=` — the parameters are `to_email` / `html_content`.
    #   4. `created[...].get('_token', token)` — `_token` was NEVER a key on
    #      those dicts, so it always fell through to the loop variable, which
    #      after the loop holds the LAST signer's token. Every signer would have
    #      received the same link, and any one of them could have signed as any
    #      other.
    #
    # Fault 4 is why fixing the import alone would have been worse than leaving
    # this dead: it would have turned a feature that sends nothing into one that
    # sends every party the authority to sign for every other party.
    sent, failed = 0, []
    for email, name, tok in outbox:
        frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
        sign_url = f"{frontend_url}/sign/{tok}"
        try:
            ok = send_email(
                to_email=email,
                subject="Signature requested — please review and sign",
                html_content=(
                    f"<p>Hi {html.escape(name)},</p>"
                    f"<p>You have been asked to sign a document. "
                    f"<a href='{sign_url}'>Click here to review and sign</a>.</p>"
                    f"<p>This link expires in {DEFAULT_EXPIRY_DAYS} days.</p>"
                ),
            )
        except Exception as e:                       # noqa: BLE001 — reported, not swallowed
            logger.warning("Signing email to %s raised: %s", email, e)
            ok = False
        if ok:
            sent += 1
        else:
            failed.append(email)

    if failed:
        # The signer rows and their links are already valid, so this is not
        # fatal — but the caller must not be told "sent" when it was not. A firm
        # that thinks an engagement letter went out will not chase it.
        logger.error(
            "Signature request: %d of %d emails failed (%s)",
            len(failed), len(outbox), ", ".join(failed),
        )

    return created, failed


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

    # Same three faults as the signature request had — wrong module path, await
    # on a sync function, wrong parameter names — and the same bare `except`
    # hiding them. This one mattered doubly: with the OTP mail dead, a signer who
    # somehow received a valid link out of band still could not complete, so the
    # whole flow was unreachable rather than merely awkward.
    try:
        ok = send_email(
            to_email=signer["email"],
            subject=f"Your verification code: {otp}",
            html_content=(
                f"<p>Your one-time verification code is: <strong>{otp}</strong></p>"
                f"<p>This code is valid for {OTP_EXPIRY_MINUTES} minutes.</p>"
            ),
        )
    except Exception as e:                           # noqa: BLE001 — reported, not swallowed
        logger.warning("OTP email to %s raised: %s", signer["email"], e)
        ok = False

    if not ok:
        # The caller shows "we sent you a code". If it never left, saying so is
        # the difference between the signer retrying and the signer giving up.
        logger.error("OTP email to %s was not sent", signer["email"])
        return False

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
    # The contract UPDATE was org-scoped but the signer UPDATE below was not,
    # so a caller in another org silently expired every pending signer on a
    # contract they could not otherwise touch — the contract row stayed
    # 'sent' while nobody could sign it. Fail on the contract first so the
    # rest of the function only runs for a contract this org owns.
    result = await pool.execute(
        "UPDATE staging.ganit_contracts SET signature_status='cancelled', "
        "updated_at=NOW() WHERE id=$1::uuid AND org_id=$2::uuid",
        contract_id, org_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Contract not found")
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
