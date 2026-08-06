"""
esign_service.py — the bridge between a business row and the e-Sign module.

A Ganit contract is not a signing subsystem. It is a row that sometimes needs a
document signed, and the product already has exactly one module that signs
documents: `routers/esign.py`, over `staging.sign_documents` /
`staging.sign_signers` / `staging.sign_audit_log`. This file's whole job is to
turn "send this contract for signature" into a document in THAT module, and to
answer the firm-side questions about it afterwards.

── What this file used to be, and why the signer could never sign ─────────────

It used to be a second, parallel implementation of e-signature over
`staging.ganit_contract_signers`: its own tokens, its own OTP, its own audit
trail, its own public endpoints on `routers/ganit.py`. The email it sent carried
a link to `{FRONTEND_URL}/sign/{token}`.

That URL is a FRONTEND route (`frontend/src/App.jsx:144`), and it is served by
`SigningPage`, which asks `GET /api/v1/esign/verify/{token}` — the e-Sign
module's public endpoint, which reads `staging.sign_signers`. The token in the
email had been written to `ganit_contract_signers`. It was not, and could never
be, in the table the page queries. Every signer who clicked was answered
"Invalid signing link" (`routers/esign.py:366`), and there was no other page in
the product that could have answered them: the Ganit module's own public
endpoints existed, but nothing in the frontend router ever pointed at them.

Measured on the shared staging/production database, 2026-08-05:

    staging.ganit_contract_signers        0 rows — ever
    staging.ganit_contract_audit_trail    0 rows — ever
    staging.sign_signers                101 rows, 44 signed
    staging.sign_documents               75 rows, 28 completed

Several contracts carry `signature_status='signed'`; not one of them has a
`signed_at`, and not one has a signer row behind it. Those values are seeded.
Nothing has ever been signed through this path.

── Why the WRITE was the wrong side, and not the link or the page ─────────────

Pointing the email at a Ganit-specific route instead would have made the link
resolve and would still have been wrong, because of what is on the other end:

  * A Ganit contract has no document. `staging.ganit_contracts.file_key` is
    empty on all 63 rows, and no endpoint uploads one. The signer would have
    been asked to sign a title and a description.
  * The parallel path produced no executed PDF and no audit certificate, and
    had no code that could. `signed_pdf_url` is NULL on all 63 rows. Producing
    the counter-signed PDF is the module's entire deliverable
    (`routers/esign.py:790` onwards) and it exists only on the e-Sign side.
  * It would have manufactured a legal-looking record — signature, IP, consent,
    audit trail — attached to no document at all. That is worse than a dead
    link, not better.

So the fix is here: a contract sent for signature becomes a real e-sign
document, on the one token namespace the product's one public signing page
reads, and it inherits the executed PDF and the certificate for free. A contract
with no document attached is REFUSED rather than sent — see
`send_for_signature`.

`sign_documents.source_module` / `source_id` are what let the firm-side views
find their document again. They arrive in migration 102, which must be applied
before this path can run.
"""
import hashlib
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

# Root module, NOT `services.email_service` — that path does not exist and the
# import error was being swallowed by a bare `except Exception`. Imported at
# module scope so a wrong path fails at startup rather than silently at send.
from email_service import send_email

logger = logging.getLogger(__name__)

SIGNER_TOKEN_BYTES = 32
DEFAULT_EXPIRY_DAYS = 7

# The value written to `sign_documents.source_module` for a Ganit contract. One
# constant rather than a string literal in five queries, because a typo in any
# one of them silently orphans the document from the contract that spawned it —
# the send would succeed and the firm's drawer would show nothing.
SOURCE_GANIT_CONTRACT = "ganit_contract"

#: Which MODULE a source row belongs to, for the sensitivity check below.
#: `source_module` names the KIND of row ("ganit_contract"); this maps it to the
#: module code the RBAC layer knows ("ganit"). Two names because a module can
#: spawn more than one kind — a Vikray quotation and a Vikray order would both
#: be "vikray" here.
SOURCE_MODULE_OF = {SOURCE_GANIT_CONTRACT: "ganit"}


async def visible_source_modules(pool, user_id: str, org_id: str) -> list[str]:
    """The `source_module` values this caller may see inside the e-Sign module.

    ── WHY THIS EXISTS ─────────────────────────────────────────────────────

    Routing Ganit contracts through e-Sign moved a SENSITIVE module's data into
    a NON-SENSITIVE one's table. `middleware/subscription.SENSITIVE_MODULES` is
    {vetana, ganit, manav, pahchan}; `esign` is in none of those tiers. So once
    a contract became a `sign_documents` row, its title, description, stored PDF
    and full signing evidence were readable by anyone holding the e-sign grant —
    including someone their org deliberately did not give Ganit to.

    That is a module boundary crossed by a schema change, which is the kind that
    no guard notices, because every guard on the e-sign endpoints was still
    doing its job correctly.

    The answer is not to un-route it: one signing implementation is the whole
    point, and the parallel one produced no executed PDF and no certificate.
    The answer is that a document REMEMBERS where it came from, and a reader who
    cannot reach that module does not see it.

    A document with `source_module IS NULL` was created in the e-Sign module
    itself and is unaffected — that is all 75 existing rows.
    """
    allowed: list[str] = []
    for source, module_code in SOURCE_MODULE_OF.items():
        held = await pool.fetchval(
            "SELECT 1 FROM staging.org_member_modules "
            "WHERE user_id=$1 AND org_id=$2::uuid AND module_code=$3",
            user_id, org_id, module_code,
        )
        if held:
            allowed.append(source)
    return allowed


def generate_token() -> str:
    return secrets.token_urlsafe(SIGNER_TOKEN_BYTES)


def hash_pdf(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()


def signing_url(frontend_url: str, token: str) -> str:
    """The link a signer receives.

    Pure, and separated out for one reason: this single string is the join
    between the token we mint and the page that resolves it. `/sign/:token` is
    declared in `frontend/src/App.jsx` and served by `SigningPage`, which calls
    `GET /api/v1/esign/verify/{token}` against `staging.sign_signers`. Anything
    that changes this path has to change that route, and a test can hold the two
    together only if the path is readable without a database.
    """
    return f"{(frontend_url or '').rstrip('/')}/sign/{token}"


def contract_document_fields(contract: dict, file_hash: str, signers_total: int,
                             created_by: str, expiry_days: int = DEFAULT_EXPIRY_DAYS,
                             now: datetime | None = None) -> dict:
    """The `sign_documents` row a contract becomes. Pure, so it can be asserted on.

    The pool is mocked in this repo's tests and will happily accept an INSERT
    against a table that does not exist, so "the right columns went to the right
    table" cannot be established by exercising the write. It can be established
    here: this function decides every value, takes no IO, and the caller does
    nothing but hand the result to one INSERT.

    `status` is 'sent' and not 'draft'. The e-Sign module splits creation from
    sending across two endpoints because a firm uploads a file and then decides;
    a contract arrives with its signers already named and the firm has already
    confirmed the send, so there is no draft state to sit in — and a document
    left at 'draft' would be invisible to `_doc_status_guard`'s expiry handling
    and would show in the e-Sign module as an unsent draft the firm never made.
    """
    now = now or datetime.now(timezone.utc)
    return {
        "org_id": str(contract["org_id"]),
        "title": contract["title"],
        "description": contract.get("description") or "",
        "file_key": contract["file_key"],
        # `sign_documents.file_url` is NOT NULL and `ganit_contracts.file_url`
        # is not — a contract can carry a key with no stored URL, which is the
        # normal state for anything uploaded after presigned URLs stopped being
        # persisted. The key is the durable reference and every read path
        # re-signs from it (`_refresh_file_url`), so an empty string here costs
        # nothing; a None would fail the INSERT and lose the send.
        "file_url": contract.get("file_url") or "",
        "file_hash": file_hash,
        "status": "sent",
        "signers_total": signers_total,
        "expires_at": now + timedelta(days=expiry_days),
        "created_by": created_by,
        "source_module": SOURCE_GANIT_CONTRACT,
        "source_id": str(contract["id"]),
    }


async def _document_for_contract(pool, contract_id: str):
    """The e-sign document a contract was sent as, or None.

    Ordered newest-first and limited to one because a contract may be sent,
    cancelled and sent again: the current request is the latest one. Older
    documents keep their own rows, their own audit trail and their own executed
    PDF — they are evidence of what happened and are not rewritten.
    """
    return await pool.fetchrow(
        "SELECT * FROM staging.sign_documents "
        "WHERE source_module=$1 AND source_id=$2::uuid "
        "ORDER BY created_at DESC LIMIT 1",
        SOURCE_GANIT_CONTRACT, contract_id,
    )


async def send_for_signature(
    pool, contract: dict, signers: list[dict], sent_by: str,
) -> tuple[list[dict], list[str]]:
    """Create the e-sign document for a contract and email each signer its link.

    Returns `(created, failed_emails)`. The second element exists because this
    used to report success unconditionally: every send raised, the exception was
    swallowed, and the endpoint answered `{"status": "sent"}`. A firm that
    believes an engagement letter went out does not chase it.

    Raises HTTPException(409) when the contract has no document attached. That
    refusal is the point, not an inconvenience: the alternative is emailing a
    stranger a link to put their signature on a title.
    """
    from services.storage import download_file

    org_id = str(contract["org_id"])
    file_key = (contract.get("file_key") or "").strip()

    # ── ONE LIVE REQUEST PER CONTRACT ───────────────────────────────────────
    #
    # This INSERTed unconditionally, so pressing Send twice minted a SECOND
    # document with a second set of signers and a second set of emailed links —
    # and `_document_for_contract` returns only the newest, so the first set
    # stayed live while being invisible to the firm-side status and cancel
    # screens. Nobody could stop links they could not see.
    #
    # The e-Sign module's own door already refuses this
    # (`routers/esign.py:292`, 400 "Document already sent"); the bridge did not,
    # which meant the guard bound whoever came through the front and not
    # whoever came through the side.
    #
    # LIVE means sent, opened or partially signed. A cancelled or completed
    # document is finished business and a contract may legitimately be sent
    # again after either — that is why `_document_for_contract` is ordered
    # newest-first rather than assuming one exists.
    existing = await pool.fetchrow(
        "SELECT id, status FROM staging.sign_documents "
        "WHERE source_module=$1 AND source_id=$2::uuid "
        "  AND status IN ('sent', 'opened', 'partially_signed') "
        "LIMIT 1",
        SOURCE_GANIT_CONTRACT, str(contract["id"]),
    )
    if existing:
        raise HTTPException(
            409,
            "This contract has already been sent for signature and is still "
            "awaiting signatures. Cancel the existing request before sending "
            "it again, or the earlier links stay live.",
        )

    if not file_key or file_key == "pending":
        raise HTTPException(
            409,
            "This contract has no document attached, so there is nothing to "
            "sign. Attach the contract file first, then send it for signature.",
        )

    # The hash is the tamper-evidence anchor: it is what the audit certificate
    # records as `original_file_hash`, and it is the whole of the IT Act §10A
    # claim that alterations are detectable. It has to be the hash of the bytes
    # the signer is shown, so it is computed from the object itself rather than
    # copied from anywhere. A file we cannot read is a signature request we
    # cannot honestly make.
    original = await download_file(file_key, org_id, contract.get("file_url"))
    if not original:
        raise HTTPException(
            409,
            "The contract document could not be read from storage, so the "
            "signature request cannot be made. Re-upload the file and try again.",
        )
    file_hash = hash_pdf(original)

    fields = contract_document_fields(contract, file_hash, len(signers), sent_by)
    doc = await pool.fetchrow(
        "INSERT INTO staging.sign_documents "
        "(org_id, title, description, file_key, file_url, file_hash, status, "
        " signers_total, expires_at, created_by, source_module, source_id) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid) "
        "RETURNING id",
        fields["org_id"], fields["title"], fields["description"],
        fields["file_key"], fields["file_url"], fields["file_hash"],
        fields["status"], fields["signers_total"], fields["expires_at"],
        fields["created_by"], fields["source_module"], fields["source_id"],
    )
    doc_id = doc["id"]

    created = []
    # (email, name, token) per signer, kept LOCAL. The token must never enter
    # `created`: the caller returns it verbatim as the HTTP body
    # (`routers/ganit.py` — `{"status": "sent", "signers": result}`), so a token
    # there would hand every signer's signing link to whoever posted the
    # request. That is the whole authority to sign, in a response body.
    outbox: list[tuple[str, str, str]] = []
    for i, s in enumerate(signers):
        token = generate_token()
        # `staging.sign_signers` — the table `GET /api/v1/esign/verify/{token}`
        # reads (`routers/esign.py:357`), which is the endpoint the page behind
        # the emailed link calls. This line and that one are the two halves of
        # the defect this file was rewritten for; `tests/test_signing_link_
        # resolves.py` asserts they still name the same table.
        row = await pool.fetchrow(
            "INSERT INTO staging.sign_signers "
            "(document_id, org_id, name, email, phone, sign_order, token, status) "
            "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'sent') "
            "RETURNING id, token",
            str(doc_id), org_id, s["name"], s["email"], s.get("phone") or None,
            s.get("order", i + 1), token,
        )
        created.append({"id": str(row["id"]), "name": s["name"], "email": s["email"]})
        outbox.append((s["email"], s["name"], row["token"]))

    await _audit(pool, doc_id, None, "document_created", sent_by, org_id,
                 {"source": SOURCE_GANIT_CONTRACT,
                  "contract_id": str(contract["id"]),
                  "title": fields["title"],
                  "signers": len(signers)})
    await _audit(pool, doc_id, None, "document_sent", sent_by, org_id,
                 {"signers_count": len(signers)})

    await pool.execute(
        "UPDATE staging.ganit_contracts SET signature_status='pending', "
        "updated_at=NOW() WHERE id=$1::uuid AND org_id=$2::uuid",
        str(contract["id"]), org_id,
    )

    # ── Sending, and why this block is written the way it is ─────────────────
    # Four independent faults used to sit here and one `except Exception` hid
    # all four, so the endpoint answered `{"status": "sent"}` while nothing was
    # ever sent: a module path that does not exist, an `await` on a synchronous
    # function, two wrong keyword names, and a dict key that was never present —
    # which meant every signer would have received the LAST signer's token, and
    # any one of them could have signed as any other.
    #
    # The template is the e-Sign module's own `_build_signing_email`, imported
    # here rather than copied. There is exactly one email a stranger receives
    # asking them to sign, and two copies of it would drift — the previous
    # inline version had already drifted into a bare <p> with none of the
    # editorial shell, no fallback URL for clients that strip anchors, and no
    # preheader. Imported inside the function because `routers.esign` pulls in
    # the auth and subscription middleware at module scope, and a service must
    # not drag a router's dependency graph into every process that imports it.
    from routers.esign import _build_signing_email

    failed = []
    frontend_url = os.getenv("FRONTEND_URL", "")
    for email, name, tok in outbox:
        sign_url = signing_url(frontend_url, tok)
        try:
            ok = send_email(
                to_email=email,
                subject=f"Please sign: {fields['title']}",
                html_content=_build_signing_email(
                    fields["title"], name, sign_url, fields["description"],
                ),
            )
        except Exception as e:                       # noqa: BLE001 — reported, not swallowed
            logger.warning("Signing email to %s raised: %s", email, e)
            ok = False
        if not ok:
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


async def signature_state(pool, contract_id: str, org_id: str) -> dict:
    """What the firm sees: the contract's signature status and its signers.

    Reads the e-sign document, not `ganit_contract_signers`. The response keys
    are unchanged from when this was answered out of the Ganit tables, because
    `frontend/src/pages/ganit/SignatureDetail.jsx` maps over them; only the
    source of truth moved.
    """
    ct = await pool.fetchrow(
        "SELECT signature_status, signed_at FROM staging.ganit_contracts "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        contract_id, org_id,
    )
    if not ct:
        raise HTTPException(404, "Contract not found")

    doc = await _document_for_contract(pool, contract_id)
    signers = []
    if doc:
        rows = await pool.fetch(
            "SELECT id, name, email, sign_order AS signing_order, status, "
            "created_at AS sent_at, signed_at, updated_at "
            "FROM staging.sign_signers WHERE document_id=$1::uuid ORDER BY sign_order",
            str(doc["id"]),
        )
        signers = [dict(r) for r in rows]

    return {
        "signature_status": ct["signature_status"],
        "signed_at": ct["signed_at"],
        "signers": signers,
        # Returned so the drawer CAN link through, and not yet rendered by it.
        # A contract's signature request is a document in the e-Sign module now,
        # with the executed PDF and the audit certificate hanging off it, and
        # there is currently no route from this drawer to any of that — the firm
        # sees a summary that dead-ends. Stated here rather than left as a
        # silent gap: the id is the part that needed a schema change, and the
        # link is a frontend change that belongs with whoever owns that drawer.
        "esign_document_id": str(doc["id"]) if doc else None,
        "esign_document_status": doc["status"] if doc else None,
    }


async def cancel_signature(pool, contract_id: str, org_id: str, cancelled_by: str):
    """Withdraw the signature request: stop the links working, keep the evidence.

    The contract UPDATE was org-scoped but the signer UPDATE was not, so a
    caller in another org silently expired every pending signer on a contract
    they could not otherwise touch. Fail on the contract first so the rest of
    this function only runs for a contract this org owns.

    Cancelling the DOCUMENT is what actually stops the signing, because
    `_doc_status_guard` in `routers/esign.py` refuses a cancelled document on
    the read path and on both write paths. Setting the contract's own status
    without it would have been a withdrawal that the signing endpoint ignored.
    """
    if not await pool.fetchval(
        "SELECT 1 FROM staging.ganit_contracts WHERE id=$1::uuid AND org_id=$2::uuid",
        contract_id, org_id,
    ):
        raise HTTPException(404, "Contract not found")

    doc = await _document_for_contract(pool, contract_id)
    # An executed contract cannot be un-executed, and the ownership check has to
    # come BEFORE the contract's own status is touched. Writing 'cancelled' onto
    # a contract whose document every party has already signed would leave the
    # firm's list saying "withdrawn" beside a document carrying real signatures
    # and an executed PDF — the same species of lie as the parallel tables told,
    # reintroduced from the other end. The drawer hides the button in this state,
    # but the endpoint is callable without it.
    if doc and doc["status"] == "completed":
        raise HTTPException(
            409,
            "Every party has signed this contract. A signature request that is "
            "already executed cannot be withdrawn.",
        )

    await pool.execute(
        "UPDATE staging.ganit_contracts SET signature_status='cancelled', "
        "updated_at=NOW() WHERE id=$1::uuid AND org_id=$2::uuid",
        contract_id, org_id,
    )
    if not doc:
        return
    await pool.execute(
        "UPDATE staging.sign_documents SET status='cancelled', cancelled_at=NOW(), "
        "updated_at=NOW() WHERE id=$1::uuid AND status <> 'completed'",
        str(doc["id"]),
    )
    await _audit(pool, doc["id"], None, "document_cancelled", cancelled_by,
                 org_id, {"contract_id": contract_id})


async def get_audit_trail(pool, contract_id: str) -> list[dict]:
    """The signing evidence for a contract, in the shape its drawer renders.

    `SignatureDetail.jsx` reads `event`, `actor_email`, `ip_address` and
    `timestamp`; the e-Sign module's log calls three of those `action`,
    `actor_ip` and `created_at`. Aliased in SQL rather than renamed in the
    frontend: this is the second time a key mismatch has made this exact panel
    render "nothing has been recorded" for a contract that had a full trail, and
    the first time it cost the module its signing evidence for months.
    """
    doc = await _document_for_contract(pool, contract_id)
    if not doc:
        return []
    rows = await pool.fetch(
        "SELECT a.id, a.action AS event, a.actor_email, a.actor_ip AS ip_address, "
        "a.actor_user_agent AS user_agent, a.details AS metadata, "
        "a.created_at AS timestamp, s.name AS signer_name, s.email AS signer_email "
        "FROM staging.sign_audit_log a "
        "LEFT JOIN staging.sign_signers s ON s.id = a.signer_id "
        "WHERE a.document_id=$1::uuid ORDER BY a.created_at",
        str(doc["id"]),
    )
    return [dict(r) for r in rows]


async def mark_source_signed(pool, doc_id) -> None:
    """Push a completed document's outcome back to the row that asked for it.

    Called from `routers/esign.py` when the last signer signs. Without it a
    contract stays 'pending' forever while its document is executed — the firm's
    contract list would say a signature is outstanding on a contract that is
    signed, which is the same class of lie the old parallel tables told.

    A document created directly in the e-Sign module has no source and this is a
    no-op; that is the common case and it must stay cheap.
    """
    row = await pool.fetchrow(
        "SELECT source_module, source_id FROM staging.sign_documents WHERE id=$1::uuid",
        str(doc_id),
    )
    if not row or not row["source_module"]:
        return
    if row["source_module"] == SOURCE_GANIT_CONTRACT:
        await pool.execute(
            "UPDATE staging.ganit_contracts SET signature_status='signed', "
            "signed_at=NOW(), updated_at=NOW() WHERE id=$1::uuid",
            str(row["source_id"]),
        )
    else:
        # A new source module was wired up and nobody taught this function about
        # it. Loud, because the symptom otherwise is a row that silently never
        # learns its document was signed.
        logger.error("esign: no completion handler for source_module=%r (document %s)",
                     row["source_module"], doc_id)


async def _audit(pool, doc_id, signer_id, action: str, actor_email: str,
                 org_id: str | None = None, details: dict | None = None,
                 ip: str = None, ua: str = None):
    await pool.execute(
        "INSERT INTO staging.sign_audit_log "
        "(document_id, signer_id, org_id, action, actor_email, actor_ip, "
        " actor_user_agent, details) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb)",
        str(doc_id), str(signer_id) if signer_id else None, org_id,
        action, actor_email, ip, ua, json.dumps(details or {}),
    )
