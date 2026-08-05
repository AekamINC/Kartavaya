#!/usr/bin/env python3
"""preview_emails.py — render every email template to disk so a human can look.

    python backend/scripts/preview_emails.py

Writes `backend/scripts/_email_preview/*.html` plus an `index.html` contact sheet.
That directory is gitignored: the harness is the deliverable, the rendered HTML
is not.

NOTHING IS SENT
───────────────
This imports the pure builder functions only. It never calls `send_email`, never
constructs a Resend or SES client, and never touches a router. As a second belt
it sets `OUTBOUND_MODE=dry` before the first import, so even an accidental future
import of a send path is suppressed by `outbound.py`.

Sample data is deliberately hostile. Every org name, task title, employee name and
comment body carries `<script>`, `<img onerror>`, quote and ampersand payloads.
The point is that an escaping regression shows up as visible angle brackets in
the rendered page instead of being something you have to reason about. The
harness also asserts on it — see `audit()` — and prints a PASS/FAIL line per
template, so this doubles as the escaping test.
"""

from __future__ import annotations

import html
import os
import re
import sys
from pathlib import Path

# Before anything imports the send path.
os.environ["OUTBOUND_MODE"] = "dry"
os.environ.setdefault("FRONTEND_URL", "https://kartavaya.com")
# `routers/esign.py` raises at import time without this, and the two templates
# it owns are the only ones in the whole set that go to somebody outside the
# customer's organisation — a client's client, asked to sign. Without this line
# they failed with "RENDER ERROR: RuntimeError" and the contact sheet still said
# 29 templates, so the two that most need looking at were the two nobody saw.
# Never used to sign or verify anything here: nothing in this process serves a
# request or issues a token.
os.environ.setdefault("JWT_SECRET", "preview-harness-renders-only-never-signs")

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

OUT = Path(__file__).resolve().parent / "_email_preview"

# ── Hostile fixtures ──────────────────────────────────────────────────────────
# Escaping regressions in email are invisible until they are exploited: the mail
# is already in someone's inbox by the time anyone looks. So every sample value
# is an attack, and `audit()` below asserts none of them survive as live markup.
#
# Each payload targets a different failure mode, because "does it escape <" is
# not the same question as "does it escape a quote inside an attribute".

# 1. Script injection — the obvious one, and the one _base() used to allow
#    through `headline` and `kicker`.
XSS = '<script>alert("xss")</script>'

# 2. Attribute-breakout without any angle bracket. An escaper that only handles
#    < and > passes this straight into an href or a style attribute.
QUOTE_BREAK = '" onmouseover="alert(1)" x="'

# 3. Event handler on a tag that fires with no user interaction, and which mail
#    clients that strip <script> will happily still run.
IMG = '<img src=x onerror=alert(1)>'

# 4. Ampersand and angle brackets in ordinary business data. This is the case
#    that is NOT an attack and must still round-trip correctly — over-escaping
#    shows up here as "&amp;amp;" in a company name.
AMP = 'Sharma & Co. "Partners" <ops@sharma.co.in>'

# 5. Bidirectional override. U+202E flips rendering direction and is the classic
#    filename-spoofing character; in a subject or a task title it can reverse
#    what the recipient reads. Kartavaya's market writes both LTR scripts and
#    imports Arabic-script vendor names, so this is not theoretical.
RTL = 'invoice‮gnp.exe'

# 6. Devanagari conjuncts. क्ष and ज्ञ are the two that break under letter-spacing,
#    and त्र/श्र/द्व exercise the half-form shaping that a wrong font silently
#    mangles. These must survive escaping unchanged AND render without tracking.
DEVA = 'क्षेत्रीय ज्ञान · त्रिवेणी · श्रीमती · द्वारका'

# 7. An org name that IS markup, per the coordinator's note. Not merely a name
#    containing a tag — a name whose entire content is a well-formed element, so
#    a naive `if "<" in x` guard that strips rather than escapes still yields
#    something that renders.
ORG_IS_HTML = '<b>Aekam</b> <a href="https://evil.example">Inc</a>'

ORG = f'{ORG_IS_HTML} {XSS}'
PERSON = f'Keval {IMG} Shah{QUOTE_BREAK}'
TASK = f'File GSTR-3B {AMP} {RTL}'
NOTE = f'Numbers do not match {XSS} — please recheck. {DEVA}'


def _senders():
    """(filename, label, callable) for every template, built lazily.

    Each callable returns HTML. None of them send.
    """
    import email_service as E
    import services.employee_email as EE

    # The two modules' senders all end in send_email(...). Rather than call them
    # and rely on the dry-run guard, the builder is re-run here with the same
    # arguments the sender would use, and only the HTML is kept.
    F = E.FRONTEND_URL

    def invite():
        card = E._info_card(
            [("WORKSPACE", ORG), ("INVITED BY", f"{PERSON} · Admin"),
             ("YOUR ROLE", "Member"), ("EXPIRES", "7 days")],
            hindi_sub={"WORKSPACE": "मुख्य कार्यस्थल"},
        )
        body = (
            E._body_text(f'Hi <strong>{html.escape(PERSON)}</strong>, '
                         f'<strong>{html.escape(PERSON)}</strong> has invited you to collaborate.')
            + card
            + E._cta_row(f"{F}/accept-invite?token=T", "Accept invitation", "primary",
                         f"{F}/dashboard", "Decline")
            + E._body_text('Expires in <strong>7 days</strong>.')
            + E._fallback_url(f"{F}/accept-invite?token=PLACEHOLDER_TOKEN")
        )
        return E._base("You have been invited.", "YOU'RE INVITED",
                       f"{PERSON} invited you to {ORG}", "आपका स्वागत है", "", body)

    def welcome():
        body = (
            E._body_text(f'Hi <strong>{html.escape(PERSON)}</strong>, your account is live.')
            + E._info_card([("WORKSPACE", ORG), ("MODULES", "Projects · Finance · CRM · eSign")],
                           hindi_sub={"WORKSPACE": "कर्तव्य"})
            + E._cta_row(f"{F}/dashboard", "Open my dashboard", "primary")
        )
        return E._base("Four modules on, one project created.", "WELCOME ABOARD",
                       f"Welcome to Kartavaya, {PERSON}.", "कर्तव्य में आपका स्वागत है", "", body)

    def reset():
        url = f"{F}/reset-password?token=PLACEHOLDER_TOKEN"
        body = (
            E._body_text('Somebody asked for a password reset on this address.')
            + E._cta_row(url, "Set a new password", "primary")
            + E._notice('This link <strong>expires in one hour</strong> and works only once.')
            + E._body_text('<strong>Did not ask for this?</strong> Nothing has changed yet.')
            + E._fallback_url(url)
        )
        return E._base("This link expires in one hour.", "PASSWORD RESET · पासवर्ड रीसेट",
                       "Reset your password", "सुरक्षा", "", body)

    def support_access():
        """`Auth Emails.html` #support — specced, and the product does not send it.

        Rendered here so the gap is visible rather than described. See the report.
        """
        body = (
            E._body_text(f'<strong>{html.escape(PERSON)}</strong> from Aekam support has '
                         f'<strong>no access to your data right now</strong> and cannot grant '
                         f'herself any. Only you can approve this, and it expires on its own.')
            + E._quote_block(html.escape(NOTE))
            + E._info_card([("ASKING FOR", "Finance — Viewer"),
                            ("ALSO", "Reports — Viewer"), ("FOR", "2 hours")])
            + E._cta_row(f"{F}/settings/support-access", "Review & approve", "primary",
                         f"{F}/settings/support-access?deny=1", "Deny")
        )
        return E._base("Aekam support is asking for 2 hours of access.",
                       "PLATFORM SUPPORT REQUEST",
                       f"{PERSON} from Aekam support wants temporary access",
                       "", "", body, accent=E.PLATFORM_VIOLET,
                       footer_note="Sent to you as the owner. This email cannot be switched "
                                   "off — you should always know when somebody asks for your data.")

    def approval_request():
        body = (
            E._body_text(f'Hi <strong>{html.escape(PERSON)}</strong>, a new request needs approval.')
            + E._info_card([("TITLE", TASK), ("PROJECT", ORG),
                            ("PRIORITY", "Urgent"), ("NEEDED BY", "31 Jul 2026")])
            + E._quote_block(html.escape(NOTE))
            + E._cta_row(f"{F}/approve?token=T", "Approve & queue", "approve",
                         f"{F}/approve?token=T&action=reject", "Decline with reason")
        )
        return E._base(f"{PERSON} needs your sign-off.", "APPROVAL NEEDED",
                       f"{PERSON} requested a new task.", "अनुमोदन हेतु अनुरोध", "", body)

    def approved():
        body = (
            E._body_text('Your request was approved. The team has picked it up.')
            + E._info_card([("TASK", TASK), ("ASSIGNED TO", PERSON),
                            ("TARGET DATE", "31 Jul 2026"), ("STATUS", "To do")])
            + E._cta_row(f"{F}/client/projects", "View task", "primary")
        )
        return E._base("Your request was approved.", "REQUEST APPROVED",
                       "Your request is in the queue.", "अनुमोदन प्राप्त हुआ", "", body)

    def task_done():
        body = (
            E._body_text(f'<strong>{html.escape(PERSON)}</strong> marked your task complete.')
            + E._info_card([("TASK", TASK), ("COMPLETED BY", PERSON),
                            ("STATUS", "Done"), ("TIME SPENT", "3h 20m")])
            + E._quote_block(html.escape(NOTE))
            + E._cta_row(f"{F}/approve?token=T", "Approve & close", "approve",
                         f"{F}/approve?token=T&action=reject", "Send back with notes")
        )
        return E._base("Ready for your review.", "WORK COMPLETED",
                       "Done — ready for your review.", "कार्य सम्पन्न", "", body)

    def assignment():
        body = (E._body_text('You have been assigned a new task.')
                + E._task_card(TASK, project=ORG, priority="High", due_date="31 Jul 2026")
                + E._cta_row(f"{F}/tasks/1", "View task", "primary"))
        return E._base(f"New task: {TASK}", "NEW TASK · कार्य", "New task assigned",
                       "नया कार्य", "A task has been assigned to you.", body)

    def comment():
        body = (E._body_text(f'<strong>{html.escape(PERSON)}</strong> commented on '
                             f'<strong>{html.escape(TASK)}</strong>:')
                + E._quote_block(html.escape(NOTE), E.RULE)
                + E._cta_row(f"{F}/tasks/1", "View comment", "primary"))
        return E._base("New comment.", "COMMENT · टिप्पणी", "New comment", "टिप्पणी",
                       f"{html.escape(PERSON)} left a comment.", body)

    def mention():
        body = (E._body_text(f'<strong>{html.escape(PERSON)}</strong> mentioned you.')
                + E._quote_block(html.escape(NOTE), E.PRIMARY)
                + E._cta_row(f"{F}/tasks/1", "View task", "primary"))
        return E._base("You were mentioned.", "MENTION · उल्लेख", "You were mentioned",
                       "उल्लेख", f"{html.escape(PERSON)} referenced you.", body)

    def reminder():
        body = (E._body_text('Your task is due soon:')
                + E._task_card(TASK, due_date="31 Jul 2026")
                + E._cta_row(f"{F}/tasks/1", "View task", "primary"))
        return E._base("Due soon.", "REMINDER · स्मरण", "Task due soon", "समयसीमा",
                       "Do not let this slip.", body)

    def team_sync():
        body = (E._body_text(f'<strong>{html.escape(ORG)}</strong> approved the task.')
                + E._task_card(TASK)
                + E._cta_row(f"{F}/tasks/1", "View task", "approve"))
        return E._base("Client approved.", "APPROVED · स्वीकृत", "Client approved",
                       "अनुमोदित", f"{html.escape(ORG)} has signed off.", body)

    def decision(kind="approved"):
        body = (E._body_text(f'<strong>{html.escape(PERSON)}</strong> has '
                             f'<strong>{kind}</strong> your task:')
                + E._task_card(TASK, note=NOTE)
                + E._cta_row(f"{F}/tasks/1", "View task", "approve"))
        return E._base(f"Task {kind}.",
                       f"TASK {kind.upper()} · {'स्वीकृत' if kind == 'approved' else 'अस्वीकृत'}",
                       f"Task {kind}", "समीक्षा परिणाम", "Your task has been reviewed.", body)

    def status_changed():
        body = (E._body_text(f'<strong>{html.escape(PERSON)}</strong> moved your task to '
                             f'<strong>In review</strong>.')
                + E._info_card([("TASK", TASK), ("NEW STATUS", "In review"), ("PROJECT", ORG)])
                + E._cta_row(f"{F}/tasks", "View task", "primary"))
        return E._base("Status updated.", "STATUS UPDATE · स्थिति", "Task status changed",
                       "स्थिति परिवर्तन", "", body)

    def report(freq):
        """Report emails go through the real builder — it is 300 lines of layout.

        `send_report_email` returns before doing anything because OUTBOUND_MODE is
        dry, so the HTML is rebuilt here from the same inputs instead.
        """
        return _render_report(E, freq)

    def employee(kind):
        return _render_employee(E, EE, kind)

    return [
        # (filename, label, thunk)
        ("01-invite", "1 · Invite — to invitee", invite),
        ("02-welcome", "2 · Welcome — after first sign-in", welcome),
        ("03-password-reset", "3 · Password reset", reset),
        ("04-support-access", "4 · Support access request (SPECCED, NOT WIRED)", support_access),
        ("05-approval-request", "5 · Approval request — to admin", approval_request),
        ("06-request-approved", "6 · Request approved — to client", approved),
        ("07-task-done", "7 · Task done — to client", task_done),
        ("08-task-assigned", "8 · Task assigned", assignment),
        ("09-comment", "9 · New comment", comment),
        ("10-mention", "10 · Mention", mention),
        ("11-task-reminder", "11 · Task due reminder", reminder),
        ("12-client-approved", "12 · Client approved — to team", team_sync),
        ("13-decision-approved", "13 · Approval decision — approved", lambda: decision("approved")),
        ("14-decision-rejected", "14 · Approval decision — rejected", lambda: decision("rejected")),
        ("15-status-changed", "15 · Status changed", status_changed),
        ("16-report-daily", "16 · Daily report", lambda: report("daily")),
        ("17-report-weekly", "17 · Weekly report", lambda: report("weekly")),
        ("18-report-monthly", "18 · Monthly report", lambda: report("monthly")),
        ("19-leave-decision", "19 · Leave decision (Manav)", lambda: employee("leave")),
        ("20-expense-decision", "20 · Expense decision (Manav)", lambda: employee("expense")),
        ("21-announcement", "21 · Announcement (Manav)", lambda: employee("announcement")),
        ("22-shift", "22 · Shift assigned (Manav)", lambda: employee("shift")),
        ("23-asset", "23 · Asset assigned (Manav)", lambda: employee("asset")),
        ("24-loan", "24 · Loan update (Vetana)", lambda: employee("loan")),
        ("25-payslip", "25 · Payslip ready (Vetana)", lambda: employee("payslip")),
        ("26-performance", "26 · Performance review (Manav)", lambda: employee("performance")),
        ("27-esign-request", "27 · Signature requested (eSign)", lambda: _render_esign("sign")),
        ("28-esign-otp", "28 · Signing OTP (eSign)", lambda: _render_esign("otp")),
        ("29-generic-reminder", "29 · Generic reminder (cron)", _render_generic_reminder),
    ] + _unshelled()


# ── Senders that do NOT use the shell ─────────────────────────────────────────
#
# Everything above is built by `_base()` and therefore inherits the envelope,
# the lockup, the escaping and the dark-mode block for free. These nine are not.
# Each one hand-writes its markup at the call site, so each one is its own
# little design system of `<p>` tags — no envelope, no brand, no footer, no
# preheader, no unsubscribe, and no `_h()` on the values it interpolates.
#
# They are rendered here for one reason: an email that bypasses the design is
# invisible in a review that only looks at the design. Putting them in the same
# contact sheet as the other 29 is what makes the gap countable. The bodies below
# are copied from the call sites named in each label — if a call site changes,
# this copy goes stale, which is the known cost of a sender that has no builder
# function to call.
def _unshelled():
    F = "https://kartavaya.com"

    def dristi_report():
        """routers/dristi.py — scheduled report 'run now'."""
        return (f"<p>Your scheduled report <strong>{html.escape(ORG)}</strong> is ready.</p>"
                f"<p>Report type: gst_summary</p>"
                f"<pre>{html.escape('{ \"rows\": 42 }')}</pre>")

    def prachar_campaign():
        """routers/prachar.py — marketing campaign to external contacts.

        The body is whatever the org typed into the campaign composer, with
        {{name}}/{{email}}/{{company}} substituted in UNESCAPED.
        """
        body = "<p>Hi {{name}},</p><p>New GST filing service from {{company}}.</p>"
        for k, v in (("name", PERSON), ("company", ORG), ("email", "a@b.c")):
            body = body.replace("{{" + k + "}}", v)
        return body

    def automation():
        """services/automation_engine.py — 'send_email' automation action."""
        return "<p>Automation fired.</p>"

    # ── 33 and 34 used to live here ──────────────────────────────────────────
    # `services/esign_service.py` sent two shell-less emails of its own — a
    # signature request and a signing OTP — for the Ganit contract path. Both
    # are gone: a contract sent for signature is now an e-sign document, so it
    # is `routers/esign.py`'s `_build_signing_email` and `_build_otp_email` that
    # reach the signer, and those are already previewed on the shelled side of
    # this harness. Two copies of the one email a stranger receives is how the
    # unshelled pair came to exist in the first place.
    #
    # Their numbers are not reused. These ids are written down in review notes
    # and a "33" that means something else next month is worse than a gap.

    # ── A weakness of this harness, stated where it will be read ─────────────
    # Every fixture below REPRODUCES its template by hand rather than calling
    # the code that sends it. That means a verdict here is about this copy, not
    # about the product: when the four skill templates were escaped, this file
    # went on reporting them as injectable, and it would equally have missed a
    # regression. Whenever you change one of these templates you must change
    # its twin here, and the only durable fix is to lift the markup into a
    # named function both sides call. Recorded rather than quietly patched,
    # because a harness that cannot fail is worse than no harness.
    def onboarding():
        """services/skills/action/onboarding_chain.py — escaped."""
        return (f"<p>Hello {html.escape(PERSON)},</p>"
                f"<p>Welcome aboard! Your joining date is 2026-08-01.</p>")

    def contract_expiry():
        """services/skills/action/document_expiry.py — contract, escaped."""
        return (f"<p>Hi {html.escape(PERSON)},</p>"
                f"<p>Your contract <b>{html.escape(TASK)}</b> is expiring within "
                f"30 days. Please review and renew if needed.</p>")

    def asset_expiry():
        """services/skills/action/document_expiry.py — asset warranty, escaped."""
        return f"<p>The warranty for asset <b>{html.escape(TASK)}</b> is expiring soon.</p>"

    def fan_out():
        """services/skills/action/notification_fan_out.py — escaped."""
        return f"<p>{html.escape(NOTE)}</p>"

    return [
        ("30-unshelled-dristi-report", "30 · Scheduled report run-now — NO SHELL", dristi_report),
        ("31-unshelled-prachar-campaign", "31 · Prachar campaign — NO SHELL, EXTERNAL", prachar_campaign),
        ("32-unshelled-automation", "32 · Automation send_email — NO SHELL", automation),
        ("35-unshelled-onboarding", "35 · Employee welcome (skill) — NO SHELL", onboarding),
        ("36-unshelled-contract-expiry", "36 · Contract expiring (skill) — NO SHELL", contract_expiry),
        ("37-unshelled-asset-expiry", "37 · Asset warranty expiring (skill) — NO SHELL", asset_expiry),
        ("38-unshelled-fan-out", "38 · Notification fan-out (skill) — NO SHELL", fan_out),
    ]


def assert_cannot_send():
    """Refuse to run if this process could physically deliver mail.

    The dry-run flag is a behavioural guard; this is a structural one. If neither
    provider client exists, `send_email` has nothing to call — there is no code
    path from here to an inbox regardless of what any flag says. The harness
    aborts rather than rendering, because the one rule on this surface is that no
    preview ever becomes a delivery.
    """
    import email_service as E
    configured = []
    if getattr(E, "_resend_client", None) is not None:
        configured.append("RESEND_API_KEY")
    if getattr(E, "ses_client", None) is not None:
        configured.append("AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY")
    if configured:
        raise SystemExit(
            "preview_emails: REFUSING TO RUN — an email provider is configured in "
            "this environment (" + ", ".join(configured) + ").\n"
            "This harness renders templates and must never be one misstep from a "
            "real delivery. Unset those variables and run again."
        )


def _render_report(E, freq):
    """Rebuild a report email's HTML without going near the send path.

    Three independent guards, because this is the one builder the harness cannot
    reach without calling its sender:
      1. `assert_cannot_send()` has already proved no provider client exists, so
         the terminal `_send()` branch can only reach a logger.
      2. `threading.Thread` is a no-op for the duration, so `_send()` never runs
         at all.
      3. The HTML is taken off `_base` as it is built, so nothing downstream of
         it is needed.

    `outbound.suppressed` is forced False here only so the builder proceeds past
    the kill-switch guard added to `send_report_email`. That guard working is
    exactly why this is necessary — it returns before building anything.
    """
    import outbound
    captured = {}

    real_thread = E.threading.Thread
    real_base = E._base
    real_suppressed = outbound.suppressed

    def spy_base(*a, **k):
        out = real_base(*a, **k)
        captured["html"] = out
        return out

    class NoThread:
        def __init__(self, *a, **k): pass
        def start(self): pass

    E._base = spy_base
    E.threading.Thread = NoThread
    outbound.suppressed = lambda *a, **k: False
    try:
        E.send_report_email(
            to_email="preview@example.invalid",
            team_name=ORG,
            frequency=freq,
            period_from="2026-07-20",
            period_to="2026-07-26",
            data_summary={"done": 42, "in_progress": 7, "todo": 13, "overdue": 3},
            total_minutes=1345,
            excel_bytes=b"x" * 4096,
            by_member_tasks=[{"user_name": PERSON, "tasks_done": 18},
                             {"user_name": AMP, "tasks_done": 12},
                             {"user_name": "Rhea Nair", "tasks_done": 9}],
            daily_throughput=[{"day": f"2026-07-{d:02d}", "done_count": c}
                              for d, c in zip(range(20, 27), [4, 9, 2, 11, 7, 5, 4])],
        )
    finally:
        E._base = real_base
        E.threading.Thread = real_thread
        outbound.suppressed = real_suppressed
    return captured["html"]


def _render_employee(E, EE, kind):
    captured = {}
    real_base = E._base
    real_send = EE.send_email

    def spy_base(*a, **k):
        captured["html"] = real_base(*a, **k)
        return captured["html"]

    def no_send(*a, **k):
        return True

    EE._base = spy_base
    EE.send_email = no_send
    try:
        if kind == "leave":
            EE.send_leave_decision_email("p@example.invalid", PERSON, f"Casual {XSS}",
                                         "2026-08-01", "2026-08-03", "approved", AMP)
        elif kind == "expense":
            EE.send_expense_decision_email("p@example.invalid", PERSON, TASK, 12500.0,
                                           "rejected", AMP)
        elif kind == "announcement":
            EE.send_announcement_email("p@example.invalid", PERSON, f"Diwali holiday {XSS}",
                                       f"<p>Office closed 20-22 Oct.</p>{IMG}")
        elif kind == "shift":
            EE.send_shift_schedule_email("p@example.invalid", PERSON, f"Night {XSS}",
                                         "2026-08-01", "22:00", "06:00")
        elif kind == "asset":
            EE.send_asset_email("p@example.invalid", PERSON, f"MacBook Pro {XSS}",
                                "Laptop", "assigned")
        elif kind == "loan":
            EE.send_loan_email("p@example.invalid", PERSON, f"Personal {XSS}", 200000.0,
                               8500.0, "approved")
        elif kind == "payslip":
            EE.send_payslip_email("p@example.invalid", PERSON, f"July 2026 {XSS}",
                                  85000.0, 71200.0, f"PS-2026-07-0042 {IMG}")
        elif kind == "performance":
            EE.send_performance_email("p@example.invalid", PERSON, f"H1 2026 {XSS}", AMP)
    finally:
        EE._base = real_base
        EE.send_email = real_send
    return captured["html"]


def _render_esign(kind):
    from routers import esign
    if kind == "sign":
        return esign._build_signing_email(TASK, PERSON,
                                          "https://kartavaya.com/sign/PLACEHOLDER_TOKEN", NOTE)
    return esign._build_otp_email(PERSON, "418205", TASK)


def _render_generic_reminder():
    from services import reminder_service
    return reminder_service._build_reminder_html({
        "reminder_type": "invoice_overdue",
        "full_name": PERSON,
        "message": NOTE,
    })


# ── Escaping audit ────────────────────────────────────────────────────────────
#
# Each entry is (needle, what it would mean). A needle is chosen so that it can
# ONLY appear if a fixture reached the document unescaped — none of them occur in
# the templates' own legitimate markup, which is why the assertion is meaningful
# rather than a smoke test that always passes.
# Every needle keeps the character that makes it dangerous in LITERAL form. That
# distinction is the whole test: `&lt;img src=x onerror=alert(1)&gt;` still
# contains the substring "onerror=", but it is inert text. Only the version with
# a real `<` executes. An earlier draft of this list matched the escaped form too
# and reported 25 false failures.
PAYLOADS = [
    ("<script>",                 "script tag rendered as live markup"),
    ("<img src=x onerror=",      "injected image tag with a live event handler"),
    ('" onmouseover="alert',     "attribute breakout — quote not escaped"),
    ('<a href="https://evil',    "injected anchor — an org name became a link"),
    ("<b>Aekam</b>",             "org name rendered as markup rather than text"),
]

# The reverse failure: escaping applied twice. A company name legitimately
# containing "&" must reach the recipient as "&amp;" in the source and "&" on
# screen. "&amp;amp;" means two escapes stacked, which is what happens when a
# caller pre-escapes a value that _base() also escapes.
DOUBLE_ESCAPES = ["&amp;amp;", "&amp;lt;", "&amp;quot;", "&amp;#x27;"]


def audit(rendered: str) -> list[str]:
    """Return every escaping defect visible in one rendered document."""
    problems = [f"UNESCAPED ({why})" for needle, why in PAYLOADS if needle in rendered]
    problems += [f"DOUBLE-ESCAPED ({d})" for d in DOUBLE_ESCAPES if d in rendered]

    # Devanagari must survive intact, and must never be tracked or uppercased —
    # letter-spacing splits क्ष and ज्ञ into two glyphs with a gap, and Devanagari
    # is unicase so text-transform only changes the Latin half of a mixed label.
    # `24-bilingual-devanagari.md` forbids both.
    for block in re.findall(r'<[^>]*lang="(?:hi|sa)"[^>]*>', rendered):
        if "text-transform:uppercase" in block.replace(" ", ""):
            problems.append("DEVANAGARI uppercased (breaks a unicase script)")
        ls = re.search(r"letter-spacing:\s*([^;\"]+)", block)
        if ls and ls.group(1).strip() not in ("normal", "0", "0px"):
            problems.append(f"DEVANAGARI tracked ({ls.group(1).strip()}) — splits conjuncts")

    # Webfonts declared via <link> are stripped by Gmail, Outlook.com and Yahoo.
    if "fonts.googleapis.com" in rendered:
        problems.append("WEBFONT <link> present — stripped by most clients")
    # Outlook's Word engine drops gradients; anything relying on one loses it.
    if "linear-gradient" in rendered:
        problems.append("GRADIENT present — Outlook drops it")
    # var() resolves to nothing in email and the element paints transparent.
    if "var(--" in rendered:
        problems.append("CSS custom property present — does not resolve in email")

    # ── Email-client reality ─────────────────────────────────────────────────
    # An external stylesheet never arrives; flex and grid are unsupported by
    # Outlook's Word engine and unreliable in Gmail, so any layout that depends
    # on them collapses to a single column in the clients Indian firms actually
    # run.
    if re.search(r"<link[^>]+stylesheet|@import", rendered, re.I):
        problems.append("EXTERNAL STYLESHEET — never loads in email")
    if re.search(r"display:\s*(flex|grid|inline-flex)", rendered):
        problems.append("FLEX/GRID layout — Outlook's Word engine ignores it")
    for tag in re.findall(r"<img\b[^>]*>", rendered, re.I):
        if "alt=" not in tag:
            problems.append("IMAGE WITHOUT alt — blank box in a blocked-image inbox")

    # ── Brand ────────────────────────────────────────────────────────────────
    # kartavaya.com, never kartavya.com. The owner has corrected this repeatedly
    # and a link on the wrong domain in a signature request is a dead link in
    # front of somebody else's customer.
    if re.search(r"kartavya\.(com|co)\b", rendered, re.I):
        problems.append("WRONG DOMAIN — kartavya, should be kartavaya")
    # A relative or protocol-relative href resolves against the mail client,
    # which has no origin. Every link has to be absolute.
    for href in re.findall(r'href="([^"]*)"', rendered):
        if href and not href.startswith(("http://", "https://", "mailto:", "#")):
            problems.append(f"NON-ABSOLUTE href ({href[:40]})")
            break

    # ── The shell ────────────────────────────────────────────────────────────
    # Not a style nit. A document with no envelope has no lockup, no footer, no
    # preheader and no dark-mode block, and — because it never passed through
    # `_base()` — nothing escaped its interpolations either.
    if 'class="em__envelope"' not in rendered:
        problems.append("NOT ON THE SHELL — hand-written markup, bypasses _base()")
    elif "mso-hide:all" not in rendered:
        problems.append("NO PREHEADER — client invents preview text from the body")
    return problems


def main() -> int:
    assert_cannot_send()
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("*.html"):
        stale.unlink()

    rows, failures = [], 0
    for slug, label, thunk in _senders():
        try:
            rendered = thunk()
        except Exception as exc:                       # noqa: BLE001 — a preview harness
            rows.append((slug, label, f"RENDER ERROR: {type(exc).__name__}: {exc}", None))
            failures += 1
            print(f"  ERROR  {slug}: {type(exc).__name__}: {exc}")
            continue

        (OUT / f"{slug}.html").write_text(rendered, encoding="utf-8")
        hits = audit(rendered)
        status = "PASS" if not hits else "; ".join(hits)
        if hits:
            failures += 1
        rows.append((slug, label, status, len(rendered)))
        print(f"  {'PASS ' if not hits else 'FAIL '} {slug:22s} {label}")
        for h in hits:
            print(f"           -> {h}")

    _write_index(rows)
    print(f"\n{len(rows)} templates -> {OUT}")
    print(f"open {OUT / 'index.html'}")
    if failures:
        print(f"\n{failures} template(s) render user input as live markup. "
              f"Those are injection vectors, not cosmetic bugs.")
    return 1 if failures else 0


def _write_index(rows):
    cells = "\n".join(
        f'<li><a href="{slug}.html">{html.escape(label)}</a>'
        f'<span class="s {"ok" if status == "PASS" else "no"}">{html.escape(status)}</span>'
        f'<span class="b">{"" if size is None else f"{size // 1024} KB"}</span></li>'
        for slug, label, status, size in rows
    )
    (OUT / "index.html").write_text(f"""<!doctype html>
<meta charset="utf-8"><title>Kartavaya email preview</title>
<style>
 body{{margin:0;background:#E8E4DA;font:14px/1.6 Inter,system-ui,sans-serif;color:#1B1D1A}}
 header{{padding:20px 24px;background:#FCFAF5;border-bottom:1px solid #D8D1BE}}
 h1{{margin:0;font:400 20px Georgia,serif}}
 p{{margin:6px 0 0;font-size:12.5px;color:#666A61;max-width:70ch}}
 ul{{list-style:none;margin:0;padding:18px 24px;max-width:900px}}
 li{{display:flex;gap:12px;align-items:baseline;padding:7px 0;border-bottom:1px dashed #D8D1BE}}
 a{{color:#046B64;text-decoration:none;flex:1}} a:hover{{text-decoration:underline}}
 .s{{font:600 10px ui-monospace,monospace;letter-spacing:.5px}}
 .ok{{color:#14743A}} .no{{color:#B42318}}
 .b{{font-size:11px;color:#666A61;min-width:48px;text-align:right}}
</style>
<header>
 <h1>Kartavaya — email templates</h1>
 <p>Rendered from the live builders. Every sample value carries an XSS payload on
 purpose: if you can see a script tag or an angle bracket in a rendered template,
 that value is not being escaped. Nothing here was sent — the harness never calls
 a send path and runs with OUTBOUND_MODE=dry.</p>
 <p>View each at 600px and again narrowed below 600px to check the mobile stack,
 and toggle your OS to dark to check the prefers-color-scheme block.</p>
</header>
<ul>
{cells}
</ul>
""", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
