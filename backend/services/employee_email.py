"""employee_email.py — Employee notification emails for Manav (HRMS) & Vetana (Payroll)
Fire-and-forget notifications using the shared email_service helpers.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from email_service import (
    send_email, _base, _body_text, _info_card, _cta_row, _safe_subject,
    FRONTEND_URL, _INK3, FROM_EMAIL, ses_client, to_plaintext,
)
from html import escape as _h
import logging
import threading

_log = logging.getLogger(__name__)


def _skip(email):
    return not email or not str(email).strip()


# ── What SES actually bills for ────────────────────────────────────────────
# SES meters the message it RECEIVES, in 256 KB units — not the file that was
# attached to it. A PDF travels base64-encoded, which is 4/3 of its size plus a
# newline every 76 characters, so the attachment alone is ~35% larger on the
# wire than on disk, and the HTML and text parts (also base64, they are declared
# utf-8) sit on top of that. A 190 KB slip is one unit as a file and two as a
# message. That gap is what the August alert was made of.

_B64_LINE_IN = 57       # bytes of input per line, both in `encoders.encode_base64`
_B64_LINE_OUT = 77      # ...and in MIMEText's utf-8 body encoding: 76 chars + \n

#: Everything on the message that does not scale with the PDF: 935 bytes of
#: headers, boundaries and part headers, plus the text/plain alternative — 641
#: bytes, 868 once base64'd, because `to_plaintext` strips an inline-styled
#: table down to a dozen lines. Both measured off the real `as_bytes()` document
#: at PDF sizes from 20 KB to 900 KB, where both were flat.
#:
#: The alternative is modelled rather than derived because deriving it is a
#: dozen regex passes over the document (see `to_plaintext`) that would run on
#: every suppressed send, to move a figure by 0.3% — and `send_email` declines
#: the same trade one file over, for the same reason.
_MIME_FIXED = 935 + 868


def _b64_bytes(size: int) -> int:
    """Bytes on the wire once `size` bytes are base64-encoded into a MIME part."""
    if size <= 0:
        return 0
    lines, rest = divmod(size, _B64_LINE_IN)
    return lines * _B64_LINE_OUT + (((rest + 2) // 3) * 4 + 1 if rest else 0)


def _metered_bytes(pdf_bytes: bytes, html_content: str) -> int:
    """Estimate the size of the message SES will be handed, before it is built.

    An ESTIMATE, and deliberately one. The live path replaces it with the exact
    `RawMessage` length the moment the document exists, so this figure only ever
    stands where no document is ever built — which is exactly the case worth
    recording. Staging runs OUTBOUND_MODE=dry and shares production's schema, so
    every payslip row an E2E payroll run writes is this number and nothing else.
    Without it a simulated 71-payslip run reports about half the units the same
    run would really have cost, and the one table that exists to answer "what did
    August cost" would be understating the largest send in the product.

    Measured against the real document at nine PDF sizes from 20 KB to 900 KB:
    equal to `msg.as_bytes()` to the byte at every one of them, and within 131
    bytes — 0.05%, never a unit — when the name, the address and the month are
    varied enough to move the modelled text part. The figure that stood here
    before, the length of the PDF, was short by 84,914 bytes on a 190 KB slip:
    one billed unit where SES charges two.
    """
    return (_b64_bytes(len(pdf_bytes or b""))
            + _b64_bytes(len(html_content.encode("utf-8")))
            + _MIME_FIXED)


# ── 1. Leave Decision ──────────────────────────────────────────

def send_leave_decision_email(employee_email, employee_name, leave_type, start_date, end_date, decision, reviewer_name, org_name=""):
    if _skip(employee_email):
        return
    ok = decision == "approved"
    emoji = "✅" if ok else "❌"
    card = _info_card([
        ("Leave Type", str(leave_type)),
        ("Dates", f"{start_date} → {end_date}"),
        ("Decision", f"{emoji} {decision.title()}"),
        ("Reviewed By", str(reviewer_name)),
    ])
    cta = _cta_row(f"{FRONTEND_URL}/manav?tab=leaves", "View Leaves")
    html = _base(
        preheader=f"Your leave request has been {decision}",
        kicker=f"LEAVE · अवकाश",
        headline=f"Leave {decision.title()}",
        sanskrit="अवकाश निर्णय",
        lede=f"Hi {_h(employee_name)}, your {_h(leave_type)} leave request from "
             f"{_h(start_date)} to {_h(end_date)} has been <strong>{_h(decision)}</strong> "
             f"by {_h(reviewer_name)}.",
        body_rows=card + cta,
    )
    # Every sender in this file names itself. These are the mails an employee
    # asks about — "I never got the approval" — and `purpose` is what turns the
    # log into an answer per person rather than a count of emails.
    send_email(employee_email, _safe_subject(f"Leave {decision.title()} — {leave_type}"), html,
               purpose="leave_decision")


# ── 2. Expense Decision ────────────────────────────────────────

def send_expense_decision_email(employee_email, employee_name, claim_title, amount, decision, reviewer_name, org_name=""):
    if _skip(employee_email):
        return
    ok = decision == "approved"
    emoji = "✅" if ok else "❌"
    card = _info_card([
        ("Expense", str(claim_title)),
        ("Amount", f"₹{amount:,.2f}" if isinstance(amount, (int, float)) else f"₹{amount}"),
        ("Decision", f"{emoji} {decision.title()}"),
        ("Reviewed By", str(reviewer_name)),
    ])
    html = _base(
        preheader=f"Your expense claim has been {decision}",
        kicker="EXPENSE · व्यय",
        headline=f"Expense {decision.title()}",
        sanskrit="व्यय निर्णय",
        lede=f"Hi {_h(employee_name)}, your expense claim for {_h(claim_title)} has been "
             f"<strong>{_h(decision)}</strong> by {_h(reviewer_name)}.",
        body_rows=card,
    )
    send_email(employee_email, _safe_subject(f"Expense {decision.title()} — {claim_title}"), html,
               purpose="expense_decision")


# ── 3. Announcement ────────────────────────────────────────────

def send_announcement_email(employee_email, employee_name, title, body_content, org_name=""):
    if _skip(employee_email):
        return
    # AnnouncementsTab.jsx:71 composes this in a plain <textarea> and :108 renders
    # it as text with white-space:pre-wrap. Email was the one surface treating it
    # as markup — an HR admin could put an anchor in a Kartavaya-branded mail to
    # every employee. Escape, then restore the line breaks the composer implies.
    body = _body_text(_h(str(body_content)).replace("\n", "<br>") if body_content else "")
    cta = _cta_row(f"{FRONTEND_URL}/manav?tab=announcements", "View Announcements")
    html = _base(
        preheader=f"New announcement: {title}",
        kicker="ANNOUNCEMENT · घोषणा",
        headline=str(title),
        sanskrit="घोषणा",
        lede=f"Hi {_h(employee_name)}, a new announcement has been posted.",
        body_rows=body + cta,
    )
    # One announcement fans out to every employee in the org, so this purpose is
    # the second-largest email volume the product has after payslips.
    send_email(employee_email, _safe_subject(f"Announcement — {title}"), html,
               purpose="announcement")


# ── 4. Shift Schedule Assigned ──────────────────────────────────

def send_shift_schedule_email(employee_email, employee_name, shift_name, date, start_time, end_time, org_name=""):
    if _skip(employee_email):
        return
    card = _info_card([
        ("Shift", str(shift_name)),
        ("Date", str(date)),
        ("Time", f"{start_time} – {end_time}"),
    ])
    cta = _cta_row(f"{FRONTEND_URL}/manav?tab=shifts", "View Schedule")
    html = _base(
        preheader=f"Shift assigned: {shift_name} on {date}",
        kicker="SHIFT · पारी",
        headline="Shift Assigned",
        sanskrit="पारी निर्धारण",
        lede=f"Hi {_h(employee_name)}, you have been assigned a shift.",
        body_rows=card + cta,
    )
    send_email(employee_email, _safe_subject(f"Shift Assigned — {shift_name} on {date}"), html,
               purpose="shift_schedule")


# ── 5. Asset Assignment ────────────────────────────────────────

def send_asset_email(employee_email, employee_name, asset_name, asset_type, action, org_name=""):
    if _skip(employee_email):
        return
    verb = "Assigned" if action == "assigned" else "Returned"
    card = _info_card([
        ("Asset", str(asset_name)),
        ("Type", str(asset_type) if asset_type else "—"),
        ("Action", verb),
    ])
    html = _base(
        preheader=f"Asset {verb.lower()}: {asset_name}",
        kicker="ASSET · संपत्ति",
        headline=f"Asset {verb}",
        sanskrit="संपत्ति सूचना",
        lede=f"Hi {_h(employee_name)}, the asset <strong>{_h(asset_name)}</strong> has been "
             f"{verb.lower()} {'to' if action == 'assigned' else 'from'} you.",
        body_rows=card,
    )
    send_email(employee_email, _safe_subject(f"Asset {verb} — {asset_name}"), html,
               purpose="asset_assignment")


# ── 6. Loan Update ─────────────────────────────────────────────

def send_loan_email(employee_email, employee_name, loan_type, amount, emi, action, org_name=""):
    if _skip(employee_email):
        return
    action_label = action.title()
    card = _info_card([
        ("Loan", str(loan_type) if loan_type else "Employee Loan"),
        ("Principal", f"₹{amount:,.2f}" if isinstance(amount, (int, float)) else f"₹{amount}"),
        ("EMI", f"₹{emi:,.2f}" if isinstance(emi, (int, float)) else f"₹{emi}"),
        ("Status", action_label),
    ])
    html = _base(
        preheader=f"Loan {action_label}",
        kicker="LOAN · ऋण",
        headline=f"Loan {action_label}",
        sanskrit="ऋण सूचना",
        lede=f"Hi {_h(employee_name)}, your loan has been {_h(action)}.",
        body_rows=card,
    )
    send_email(employee_email, _safe_subject(f"Loan {action_label}"), html,
               purpose="loan_update")


# ── 7. Payslip Ready ───────────────────────────────────────────

def send_payslip_email(employee_email, employee_name, month, gross, net, payslip_number, org_name="", pdf_bytes=None):
    if _skip(employee_email):
        return
    card = _info_card([
        ("Month", str(month)),
        ("Payslip #", str(payslip_number)),
        ("Gross Pay", f"₹{gross:,.2f}" if isinstance(gross, (int, float)) else f"₹{gross}"),
        ("Net Pay", f"₹{net:,.2f}" if isinstance(net, (int, float)) else f"₹{net}"),
    ])
    cta = _cta_row(f"{FRONTEND_URL}/vetana", "View Payslip")
    attach_note = _body_text(f'<span style="font-size:12.5px;color:{_INK3};">Your payslip PDF is attached to this email.</span>') if pdf_bytes else ""
    html_content = _base(
        preheader=f"Payslip ready for {month}",
        kicker="PAYSLIP · वेतन पर्ची",
        headline="Payslip Ready",
        sanskrit="वेतन पर्ची",
        lede=f"Hi {_h(employee_name)}, your payslip for {_h(month)} is now available.",
        body_rows=card + attach_note + cta,
    )
    subject = _safe_subject(f"Payslip Ready — {month} ({payslip_number})")

    # 098's own worked example: 'payslip:PS-2026-08-42'. The head becomes the
    # row's `purpose` and the whole string its `detail.ref`, so one argument
    # answers both "what did we send this org" and "which slip was that". This
    # is the sender the table was written about — a payroll run mails one of
    # these per employee, sixteen runs against 71 employees is 960 of them, and
    # left unnamed they would be the largest 'unclassified' bucket in the
    # product. That bucket is the one 098 asks us to watch fall.
    ref = f"payslip:{payslip_number}"

    if not pdf_bytes:
        send_email(employee_email, subject, html_content,
                   purpose="payslip", ref=ref)
        return

    # The attachment branch below builds its own MIME and calls Resend/SES
    # directly, so it never reaches the guard inside send_email(). Without this,
    # OUTBOUND_MODE=dry on staging — which shares production's SES identity and
    # its database — still mails real payslips to real employees on a payroll run.
    # This is the same bypass send_report_email had; both are now closed.
    #
    # `begin` rather than `suppressed`, and for the same reason
    # send_report_email uses it: this branch IS the provider call, so it is the
    # only place that can say what came back. The SES MessageId it records is
    # also the only join key a later bounce notification has — 960 payslips were
    # accepted and bounced seconds afterwards, and nothing tied the two together.
    from outbound import begin

    # The metered size of the message, not the size of the attachment — see
    # `_metered_bytes`. Refined to the exact figure below once the MIME document
    # exists; on the suppressed path no document is ever built, so this estimate
    # is the only figure that row will ever carry. `len(pdf_bytes)` stood here:
    # ~30% short on every payslip, and once a slip passes 177.5 KB — inside the
    # 140–195 KB band these PDFs land in — short by a whole billed unit, one
    # recorded where SES charges two. It never erred the other way.
    #
    # `purpose` is named as well as derived from `ref`'s head, so both branches
    # of this sender file the same way whatever `ref` is later spelled as.
    att = begin("email", employee_email, subject, ref=ref, purpose="payslip",
                bytes=_metered_bytes(pdf_bytes, html_content))
    if att.blocked:
        return

    # THE ADDRESS A PAYSLIP LEAVES FROM, which is the message this whole
    # mechanism exists for: it carries somebody's salary, there is a statutory
    # expectation behind its arrival, and today it is sent on the same
    # reputation as the marketing campaign. Captured here, on the caller's
    # thread, beside `begin()` and for the same reason — the org is in a
    # ContextVar and `_send_with_attachment` runs in a plain `threading.Thread`
    # where that context is empty and a read returns None without saying so.
    #
    # The `not pdf_bytes` branch above needs no plan of its own: it delegates to
    # `send_email`, which makes one from the `purpose="payslip"` it is passed.
    from services import email_senders
    from_plan = email_senders.plan("payslip", FROM_EMAIL)

    def _send_with_attachment():
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.mime.base import MIMEBase
        from email import encoders

        # Derived once and used twice — the MIME alternative here and, on the
        # Resend path, that provider's own `text` field. Byte-identical either
        # way; it was two full regex passes over the document per payslip.
        text_content = to_plaintext(html_content)

        # Resolved once and used on all three branches. The SES path especially
        # must not resolve twice: `send_raw_email` rejects a message whose
        # `Source` disagrees with the `From:` header in the document, and two
        # calls straddling a cache expiry could return two different strings.
        from_email = from_plan.resolve()

        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = employee_email

        alt = MIMEMultipart("alternative")
        # Text part first — see the same note in email_service.send_report_email.
        alt.attach(MIMEText(text_content, "plain", "utf-8"))
        alt.attach(MIMEText(html_content, "html", "utf-8"))
        msg.attach(alt)

        part = MIMEBase("application", "pdf")
        part.set_payload(pdf_bytes)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=f"Payslip-{payslip_number}.pdf")
        msg.attach(part)

        if ses_client:
            try:
                # Serialised once and reused, as in send_report_email:
                # `as_bytes()` re-encodes the base64 attachment, so measuring it
                # with a second call would double the work on every payslip.
                # Its length is the exact number of bytes SES receives, which is
                # what SES meters in 256 KB units — the figure the August
                # message-unit alert was actually about.
                raw = msg.as_bytes()
                r = ses_client.send_raw_email(
                    Source=from_email,
                    Destinations=[employee_email],
                    RawMessage={"Data": raw},
                )
                _log.info("✅ Payslip email (SES) → %s", employee_email)
                att.sent(
                    r.get("MessageId") if isinstance(r, dict) else None,
                    provider="ses", bytes=len(raw),
                )
            except Exception as exc:
                _log.error("❌ Payslip email (SES) failed → %s: %s", employee_email, exc)
                att.failed(exc, provider="ses")
        else:
            _log.info("[EMAIL-DEV] Payslip PDF email → %s | %s", employee_email, payslip_number)
            # Nothing left the building, and that is a failure rather than a
            # send — same reading as email_service.send_email's dev branch.
            # Leaving 71 payslip rows 'queued' would say "waiting to hear back"
            # about messages nobody posted, and a deploy that lost its SES
            # credentials mid-payroll would look healthy in the one table meant
            # to notice.
            att.failed(
                "no email provider configured "
                "(AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY unset)",
                provider="none",
            )

    threading.Thread(target=_send_with_attachment).start()


# ── 8. Performance Review ──────────────────────────────────────

def send_performance_email(employee_email, employee_name, review_period, reviewer_name, org_name=""):
    if _skip(employee_email):
        return
    card = _info_card([
        ("Review Period", str(review_period)),
        ("Reviewer", str(reviewer_name)),
    ])
    cta = _cta_row(f"{FRONTEND_URL}/manav?tab=performance", "View Review")
    html = _base(
        preheader=f"Performance review for {review_period}",
        kicker="PERFORMANCE · प्रदर्शन",
        headline="Performance Review",
        sanskrit="प्रदर्शन समीक्षा",
        lede=f"Hi {_h(employee_name)}, a performance review for {_h(review_period)} "
             f"has been submitted by {_h(reviewer_name)}.",
        body_rows=card + cta,
    )
    send_email(employee_email, _safe_subject(f"Performance Review — {review_period}"), html,
               purpose="performance_review")
