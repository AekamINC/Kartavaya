"""
pdf_email.py — send one HTML email with one PDF attached, and record it.

── Why this exists as its own module ────────────────────────────────────────

`email_service.send_email` cannot attach anything, and the two senders that
needed to (payslips, periodic reports) each grew their OWN MIME document,
provider branch and outbound-log bookkeeping. Both then had to be patched
separately for the same two bugs:

  · the attachment branch built its own provider call and so never reached the
    `OUTBOUND_MODE=dry` guard inside `send_email` — staging shares production's
    SES identity, so a payroll run on staging mailed real payslips to real
    employees, and a report run did the same
  · `bytes` was recorded as `len(pdf_bytes)`, ~30% short of what SES actually
    meters, which under-counted every message and, past ~177 KB, under-counted
    by a whole 256 KB billing unit

P5 needs a third one (an invoice with its PDF), and a third copy is how a third
instance of both bugs gets written. So the mechanism is here once, and the
callers pass what differs: the document, the filename, and how the send is
filed in `staging.outbound_log`.

── The dev branch is a FAILURE, not a send ─────────────────────────────────

With no provider configured, nothing left the building. Recording that as
'queued' would say "waiting to hear back" about a message nobody posted, and a
deploy that lost its credentials would look healthy in the one table meant to
notice.
"""
import logging
import threading

_log = logging.getLogger(__name__)


def send_pdf_email(
    *,
    to_email: str,
    subject: str,
    html_content: str,
    pdf_bytes: bytes,
    filename: str,
    purpose: str,
    ref: str,
    label: str = "PDF email",
) -> None:
    """Hand off one message with one PDF attached. Returns immediately.

    The return value is deliberately nothing: the provider call happens on a
    background thread, so any boolean returned here would be a claim about a
    send that has not been attempted yet. `staging.outbound_log` is where the
    answer is — that is the same contract `email_service.send_email` states.
    """
    from email_service import (
        FROM_EMAIL, _metered_bytes, ses_client, to_plaintext,
    )
    from outbound import begin
    from services import email_senders

    # `begin` BEFORE the thread: this branch is the provider call, so it is the
    # only place that can say what came back, and the row has to exist before
    # anything is posted. `blocked` is the dry-run guard — the one the
    # hand-rolled copies each missed.
    att = begin("email", to_email, subject, ref=ref, purpose=purpose,
                bytes=_metered_bytes(pdf_bytes, html_content))
    if att.blocked:
        return

    # Resolved on the CALLER's thread. The org is in a ContextVar and the
    # sending thread's context is empty, where a read returns None without
    # saying so — so the message would silently leave from the default address.
    from_plan = email_senders.plan(purpose, FROM_EMAIL)

    def _send():
        from email import encoders
        from email.mime.base import MIMEBase
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        # Derived once and used twice: the MIME alternative here and Resend's
        # own `text` field. Byte-identical either way, and it is a full regex
        # pass over the document.
        text_content = to_plaintext(html_content)

        # Resolved once and used on every branch. SES `send_raw_email` rejects a
        # message whose `Source` disagrees with the `From:` header, and two
        # calls straddling a cache expiry could return two different strings.
        from_email = from_plan.resolve()

        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = to_email

        alt = MIMEMultipart("alternative")
        # Text part FIRST. A MIME alternative is read last-to-first by every
        # client, so the HTML wins where it is understood and the plain text is
        # what a text-only reader falls back to.
        alt.attach(MIMEText(text_content, "plain", "utf-8"))
        alt.attach(MIMEText(html_content, "html", "utf-8"))
        msg.attach(alt)

        part = MIMEBase("application", "pdf")
        part.set_payload(pdf_bytes)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(part)

        if ses_client:
            try:
                # Serialised ONCE. `as_bytes()` re-encodes the base64
                # attachment, so measuring with a second call doubles the work
                # on every message. Its length is exactly what SES receives,
                # which is what SES meters.
                raw = msg.as_bytes()
                r = ses_client.send_raw_email(
                    Source=from_email,
                    Destinations=[to_email],
                    RawMessage={"Data": raw},
                )
                _log.info("✅ %s (SES) → %s", label, to_email)
                att.sent(
                    r.get("MessageId") if isinstance(r, dict) else None,
                    provider="ses", bytes=len(raw),
                )
            except Exception as exc:
                _log.error("❌ %s (SES) failed → %s: %s", label, to_email, exc)
                att.failed(exc, provider="ses")
        else:
            _log.info("[EMAIL-DEV] %s → %s | %s", label, to_email, ref)
            att.failed(
                "no email provider configured "
                "(AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY unset)",
                provider="none",
            )

    threading.Thread(target=_send).start()
