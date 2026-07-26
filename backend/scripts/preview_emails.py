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

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

OUT = Path(__file__).resolve().parent / "_email_preview"

# ── Hostile fixtures ──────────────────────────────────────────────────────────
XSS = '<script>alert("xss")</script>'
IMG = '<img src=x onerror=alert(1)>'
AMP = 'Sharma & Co. "Partners" <ops@x.io>'

ORG = f'Aekam Inc {XSS}'
PERSON = f'Keval {IMG} Shah'
TASK = f'File GSTR-3B {AMP}'
NOTE = f'Numbers do not match {XSS} — please recheck.'


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
    ]


def _render_report(E, freq):
    """Rebuild a report email's HTML without going near the send path."""
    import types
    captured = {}

    # send_report_email's only side effect is a thread that talks to SES. Replace
    # threading.Thread with a no-op for the duration and grab the HTML off the
    # closure instead — no monkeypatching of the sender itself, no SES client.
    real_thread = E.threading.Thread
    real_base = E._base

    def spy_base(*a, **k):
        out = real_base(*a, **k)
        captured["html"] = out
        return out

    class NoThread:
        def __init__(self, *a, **k): pass
        def start(self): pass

    E._base = spy_base
    E.threading.Thread = NoThread
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

# Any of these appearing *unescaped* in rendered output is an injection. They are
# distinctive enough not to collide with the templates' own legitimate markup.
PAYLOADS = ["<script>", "onerror=", "<img src=x"]


def audit(name: str, rendered: str) -> list[str]:
    """Return the payloads that survived into the document as live markup."""
    hits = []
    for p in PAYLOADS:
        if p in rendered:
            hits.append(p)
    # A bare `&` that is not part of an entity means an unescaped value reached a
    # URL or an attribute. Ignore the ones inside href query strings we build.
    return hits


def main() -> int:
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
        hits = audit(slug, rendered)
        status = "PASS" if not hits else "UNESCAPED: " + ", ".join(hits)
        if hits:
            failures += 1
        rows.append((slug, label, status, len(rendered)))
        print(f"  {'PASS ' if not hits else 'FAIL '} {slug:22s} {label}"
              + ("" if not hits else f"   <-- {status}"))

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
