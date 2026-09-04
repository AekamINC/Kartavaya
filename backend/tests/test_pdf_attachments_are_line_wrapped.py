"""No message this product sends may carry a line longer than 998 characters.

── WHY THIS EXISTS ─────────────────────────────────────────────────────────────

RFC 5321 §4.5.3.1.6 caps an SMTP text line at 1000 octets including the CRLF —
998 of content. A base64 attachment that is NOT wrapped is one single line as
long as the encoding: a 90 KB PDF becomes ~123,000 characters on one line. Some
receivers accept it, and some answer

    552 5.3.4 message line is too long

which is a HARD bounce. It is invisible from the sending side: SES accepts the
message, returns a MessageId, `outbound_log` files it as `sent`, and the
recipient never gets it. There is no `bounced` status anywhere in this product
(finding 22, `docs/plans/93-F-OPEN-FINDINGS.md`), so nothing would notice.

This was reported from a real incident on ANOTHER stack — a Node sender that
hand-built raw MIME with `boundary="aws-sdk-js-attachment"` and pasted
`buf.toString("base64")` straight in with no wrap. Microsoft 365 rejected those.

── WE DO NOT HAVE THAT BUG, AND THIS TEST IS WHY IT STAYS THAT WAY ─────────────

Every attachment site calls `encoders.encode_base64`, which wraps at 76
characters. Measured on the real senders below: ~1,617 body lines of exactly 76
for a 90 KB payload, longest line in the whole document 84 (a header, not the
payload).

But that is FOUR call sites agreeing by convention, and P5 wants a fifth (the
invoice PDF). `services/pdf_email.py`'s own docstring records what happened the
last time this was convention rather than a mechanism: two senders each grew
their own MIME document and each had to be patched separately for the same two
bugs. A fifth copy is how a fifth instance gets written — with `set_payload`
and no `encode_base64`, which is exactly the shape of the incident above.

So this file has two halves, and it needs both:

  · BEHAVIOURAL — drives the three real senders end to end with a real 90 KB
    payload, captures the exact bytes handed to `send_raw_email`, and measures
    every line. This is the assertion that matters. It cannot be satisfied by
    anything except a correctly wrapped document.

  · CONTRACT — every `set_payload` in the backend is followed by
    `encode_base64`. This half is the only one that can see a sender written
    NEXT MONTH, which the behavioural half does not know exists.

The contract half alone would be a static ratchet, and this repo has three
recorded cases of one staying green over a real violation
(`check-rendered-ids`, `check-table-rows`, and a test that matched the
explanatory comment above its own fix). It is here to catch NEW code, not to
prove the existing code works — the sends above do that.
"""
import re
import threading
import time
from pathlib import Path

import pytest

import outbound as outbound_mod

# RFC 5321 §4.5.3.1.6: 1000 octets including CRLF.
SMTP_LINE_LIMIT = 998

# Big enough to be a real invoice or payslip (those land 140–195 KB) and far
# past the point where an unwrapped encoding would breach the limit — 1 KB
# already would. Not sparse: a payload of all-zeros would encode to one
# repeating pattern and read as if it had been contrived to pass.
PDF_BYTES = bytes((i * 37 + (i >> 8) * 11) & 0xFF for i in range(92_160))   # 90 KB


class CaptureSES:
    """Stands in for the SES client and keeps the exact document it was given.

    `send_raw_email` runs on a `threading.Thread` started by each sender, so the
    Event is how the test knows the document exists. Every sender's SES branch
    is wrapped in a `try/except` that files the exception against the outbound
    row and swallows it, so a stub that raised would produce a PASSING test
    with nothing measured.
    """

    def __init__(self):
        self.raw = None
        self.source = None
        self.done = threading.Event()

    def send_raw_email(self, *, Source, Destinations, RawMessage):
        self.raw = RawMessage["Data"]
        self.source = Source
        self.done.set()
        return {"MessageId": "capture-not-a-real-send"}


class _Attempt:
    """`outbound.begin`'s handle, minus the database.

    `blocked = False` deliberately: the point of this test is to reach the MIME
    document, and every sender returns early when the dry-run gate is up.

    ⚠ `sender()` IS NOT OPTIONAL AND ITS ABSENCE COST THIS FILE WEEKS. It was
    added to the real handle with the senders feature, and `send_report_email`
    called it OUTSIDE its own try block, on a thread nobody joins. So the
    AttributeError from this stub killed the send silently — no log, no
    `outbound_log` row — and the only symptom was `test_report_email_wraps_pdf_AND_excel`
    failing with "the sending thread never reached SES", which names the
    consequence and nothing about the cause. The call has been moved inside the
    try (email_service.py), so the same omission now announces itself.

    The address is RECORDED rather than dropped, so a test can assert what the
    message went out as — the one question the senders feature exists to answer.
    """

    blocked = False

    def __init__(self):
        self.sender_address = None

    def sent(self, *a, **k):
        pass

    def failed(self, *a, **k):
        pass

    def sender(self, address, *a, **k):
        self.sender_address = address


class _Plan:
    def resolve(self):
        return "reports@kartavaya.com"


@pytest.fixture
def ses(monkeypatch):
    """Reach the MIME document without a database, a provider or a request."""
    import email_service
    import outbound
    from services import email_senders

    cap = CaptureSES()
    monkeypatch.setattr(email_service, "ses_client", cap)
    monkeypatch.setattr(outbound, "begin", lambda *a, **k: _Attempt())
    monkeypatch.setattr(email_senders, "plan", lambda *a, **k: _Plan())
    return cap


def measure(raw: bytes) -> dict:
    """Every line of the document, as the receiving SMTP server counts them."""
    assert raw, "no document was captured — the sender never reached SES"
    lines = [ln.rstrip(b"\r") for ln in raw.split(b"\n")]
    longest = max(lines, key=len)
    return {
        "lines": lines,
        "longest": len(longest),
        "total": len(raw),
    }


def assert_no_line_too_long(raw: bytes, who: str) -> dict:
    m = measure(raw)
    over = [(i, len(ln)) for i, ln in enumerate(m["lines"]) if len(ln) > SMTP_LINE_LIMIT]
    assert not over, (
        f"{who}: {len(over)} line(s) exceed RFC 5321's {SMTP_LINE_LIMIT}-character "
        f"limit — longest is {m['longest']} chars. A receiver is entitled to answer "
        f"'552 message line is too long', and this product would file the message "
        f"as sent. First offenders (line, length): {over[:3]}"
    )
    # POSITIVE evidence, not merely the absence of a long line: an attachment
    # that failed to encode at all — `set_payload` with no `encode_base64` puts
    # the RAW BYTES in the document — could still have no over-long line if the
    # bytes happen to contain newlines. A PDF is full of them.
    #
    # THIS IS NOT A PRECAUTION, IT IS THE FINDING. Deleting `encode_base64` from
    # `services/pdf_email.py` and re-running, the 998-character assertion above
    # stayed GREEN — the unencoded payload carried a 0x0A often enough that no
    # single line breached the limit. Only the line below went red. A test that
    # measured line length alone would have passed over a document with raw
    # binary in it, which is a worse bug than the one this file is named after.
    seventy_six = sum(1 for ln in m["lines"] if len(ln) == 76)
    assert seventy_six > 1000, (
        f"{who}: only {seventy_six} lines are exactly 76 characters. A 90 KB "
        f"payload base64-encodes to ~1,600 such lines, so the attachment was "
        f"not encoded — `set_payload` without `encoders.encode_base64` puts the "
        f"raw bytes straight into the document."
    )
    m["wrapped"] = seventy_six
    return m


# ── The three senders that attach a PDF today ──────────────────────────────────

def test_pdf_email_wraps_its_attachment(ses):
    """`services/pdf_email.py` — the shared mechanism. Reports, and P5 invoices."""
    from services.pdf_email import send_pdf_email

    send_pdf_email(
        to_email="nobody@kartavaya.invalid",
        subject="Line length probe",
        html_content="<p>Body</p>",
        pdf_bytes=PDF_BYTES,
        filename="probe.pdf",
        purpose="report",
        ref="test:line-length",
    )
    assert ses.done.wait(30), "the sending thread never reached SES"
    m = assert_no_line_too_long(ses.raw, "services/pdf_email.send_pdf_email")
    print(f"\npdf_email: {m['total']:,} bytes, {len(m['lines']):,} lines, "
          f"longest {m['longest']}, wrapped {m['wrapped']:,}")


def test_payslip_email_wraps_its_attachment(ses, monkeypatch):
    """`services/employee_email.py` — carries somebody's salary."""
    import services.employee_email as ee
    monkeypatch.setattr(ee, "ses_client", ses)     # bound at import, not read live

    ee.send_payslip_email(
        "nobody@kartavaya.invalid", "Test Person", "August 2026",
        50000, 42000, "PS-TEST-0001", org_name="Probe Org", pdf_bytes=PDF_BYTES,
    )
    assert ses.done.wait(30), "the sending thread never reached SES"
    m = assert_no_line_too_long(ses.raw, "services/employee_email.send_payslip_email")
    print(f"\npayslip: {m['total']:,} bytes, {len(m['lines']):,} lines, "
          f"longest {m['longest']}, wrapped {m['wrapped']:,}")


def test_report_email_wraps_pdf_AND_excel(ses):
    """`email_service.send_report_email` — the only sender with TWO attachments.

    Both are asserted in one message deliberately. They are separate
    `set_payload` calls, and a fix applied to one is not applied to the other.
    """
    import email_service

    email_service.send_report_email(
        to_email="nobody@kartavaya.invalid",
        team_name="Probe Team",
        frequency="weekly",
        period_from="2026-08-24",
        period_to="2026-08-30",
        pdf_bytes=PDF_BYTES,
        excel_bytes=PDF_BYTES,          # same size; the assertion is on encoding
    )
    assert ses.done.wait(30), "the sending thread never reached SES"
    m = assert_no_line_too_long(ses.raw, "email_service.send_report_email")
    # Two attachments of 90 KB each, so twice the 76-character run.
    assert m["wrapped"] > 2400, (
        f"only {m['wrapped']} wrapped lines for TWO 90 KB attachments — one of "
        f"the two (PDF or Excel) was not encoded"
    )
    print(f"\nreport (pdf+excel): {m['total']:,} bytes, {len(m['lines']):,} lines, "
          f"longest {m['longest']}, wrapped {m['wrapped']:,}")


# ── The contract, for the sender written next month ────────────────────────────

def test_a_failure_in_the_sending_thread_is_recorded_and_not_swallowed(monkeypatch):
    """⚠ THE SEND RUNS ON A THREAD NOBODY JOINS, SO ANYTHING RAISED OUTSIDE ITS
    `try` DISAPPEARS COMPLETELY — no log line, no `outbound_log` row, no
    exception where a person will look. The send simply does not happen.

    That was live. `att.sender()` and `from_plan.resolve()` sat above the `try`,
    so when the stub in this file lacked `sender()` the AttributeError killed the
    thread in silence and the only symptom was the test above timing out with
    "the sending thread never reached SES" — which names the consequence and
    says nothing about the cause. Both lines moved inside the try.

    Adding `sender()` to the stub fixed the symptom and would have left the hole
    open, because with the stub complete the test passes whichever side of the
    `try` those lines sit on. So this asserts the PROPERTY instead: make the
    resolve raise, and the failure must come back through `att.failed`.
    """
    import email_service
    from services import email_senders

    class _Exploding:
        def resolve(self):
            raise RuntimeError("sender policy lookup exploded")

    class _RecordingAttempt(_Attempt):
        def __init__(self):
            super().__init__()
            self.failure = None

        def failed(self, exc, *a, **k):
            self.failure = exc

    att = _RecordingAttempt()
    monkeypatch.setattr(email_service, "ses_client", CaptureSES())
    monkeypatch.setattr(outbound_mod, "begin", lambda *a, **k: att)
    monkeypatch.setattr(email_senders, "plan", lambda *a, **k: _Exploding())

    email_service.send_report_email(
        to_email="nobody@kartavaya.invalid", team_name="Probe Team",
        frequency="weekly", period_from="2026-08-24", period_to="2026-08-30",
        pdf_bytes=PDF_BYTES, excel_bytes=PDF_BYTES,
    )

    deadline = time.time() + 15
    while att.failure is None and time.time() < deadline:
        time.sleep(0.05)

    assert att.failure is not None, (
        "the sending thread died without recording anything — the resolve "
        "raised above the try again, and a failed report is now indistinguishable "
        "from one that was never attempted"
    )
    assert "exploded" in str(att.failure)


def test_every_set_payload_in_the_backend_is_followed_by_encode_base64():
    """The half that can see code this file does not import.

    P5 adds an invoice PDF, and the whole reason `services/pdf_email.py` exists
    is that the previous two senders were copies. If a fifth copy arrives with
    `set_payload` and no `encode_base64`, the tests above stay silent — they
    drive three named functions.

    Comments and docstrings are stripped first. A test in this repo has already
    shipped that matched the explanatory comment written above its own fix.
    """
    root = Path(__file__).resolve().parent.parent
    skip = {"tests", "venv", ".venv", "site-packages", "__pycache__", "node_modules"}
    offenders = []
    checked = 0

    for py in root.rglob("*.py"):
        if skip & set(py.parts):
            continue
        src = py.read_text(encoding="utf-8", errors="replace")
        if "set_payload" not in src:
            continue
        stripped = re.sub(r'"""(?:.|\n)*?"""', "", src)
        stripped = re.sub(r"^\s*#.*$", "", stripped, flags=re.MULTILINE)
        lines = stripped.splitlines()
        for i, line in enumerate(lines):
            if "set_payload" not in line:
                continue
            checked += 1
            # `encode_base64` must follow within a few lines. In all four
            # existing sites it is the VERY NEXT line; the window is slack for
            # a wrapped call, not licence to encode somewhere else entirely.
            window = "\n".join(lines[i + 1:i + 5])
            if "encode_base64" not in window:
                offenders.append(f"{py.relative_to(root)}:{i + 1}  {line.strip()}")

    assert not offenders, (
        "a payload is attached without being base64-encoded. Unencoded, it is "
        "ONE line as long as the file, which breaches RFC 5321's 998-character "
        "limit and earns a '552 message line is too long' hard bounce that this "
        "product files as a successful send:\n  " + "\n  ".join(offenders)
    )

    # The sweep has to have FOUND something. A refactor that renames the method
    # or moves the senders would otherwise leave this test passing over zero
    # files — the exact failure mode `check-rendered-ids` shipped.
    assert checked >= 4, (
        f"only {checked} `set_payload` call sites found; there are four "
        f"(pdf_email, employee_email, and two in email_service — PDF and Excel). "
        f"The sweep is no longer looking where the senders live."
    )
