"""A scheduled report leaves as an encrypted PDF, or it leaves without the
numbers — and the passphrase never leaves at all.

── WHAT EACH HALF DEFENDS ──────────────────────────────────────────────────

THE PASSPHRASE. The owner chose password-protected PDF over a login link, and
the whole value of that choice evaporates if the passphrase travels beside the
document. Two tests hold it, and the first is STRUCTURAL rather than
behavioural: `covering_note()` — the only builder of the email body — has no
passphrase parameter, so it cannot leak what it was never handed. A behavioural
test alone would pass the day somebody adds the parameter "just for the
template" and forgets to remove the interpolation.

THE SIZE GUARD. The owner asked whether a recipient server would answer "552
too long". It might, and this product could not hear it: `staging.outbound_log`
has no `bounced` status and there is no SNS endpoint, so the row would read
`sent` for ever (finding 22). The defence is therefore not to provoke it. The
subtle half — and the one a careless implementation gets wrong — is that
AES-256 INFLATES the document (a real 18,970 B report becomes 25,823 B, +36%),
so a guard that measures the plain PDF while the encrypted one travels is a
guard that passes on a message that fails. `test_the_ceiling_is_measured_on_
the_encrypted_document` is set at a limit that sits BETWEEN the two, so it can
only pass if the right one is measured.

⚠ SEPARATE FROM, AND COMPLEMENTARY TO,
`tests/test_pdf_attachments_are_line_wrapped.py`. That file covers the OTHER
cause of a 552 — an unwrapped base64 line over RFC 5321's 998-octet limit. This
file covers total message size. Both produce the same SMTP code from different
causes and neither test subsumes the other.

Run:  cd backend && python -m pytest tests/test_report_delivery.py -q
"""
import inspect
import io
import logging

import pytest

from services import report_delivery as rd

PASSPHRASE = "a-long-enough-report-passphrase"


def _pdf(pages: int = 1, filler: int = 0) -> bytes:
    """A real, parseable PDF. Built with pypdf so the fixture cannot drift from
    the library that has to read it back, and so `filler` can grow it past a
    ceiling without checking a megabyte into the repository."""
    from pypdf import PdfWriter

    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)
    if filler:
        # Metadata is carried verbatim into the document, which is the cheapest
        # honest way to make a PDF genuinely larger rather than mocking a size.
        w.add_metadata({"/Subject": "x" * filler})
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


ORG = {"name": "Unicode Group"}
NOTE_ARGS = dict(org=ORG, report_name="S12 Weekly 01", label="Finance",
                 period_line="23 Aug 2026 – 29 Aug 2026",
                 frontend_url="https://staging.kartavaya.com")


# ═════════════════════════════════════════════════════════════════════════════
# THE PASSPHRASE NEVER LEAVES
# ═════════════════════════════════════════════════════════════════════════════

def test_the_covering_note_cannot_be_handed_the_passphrase():
    """STRUCTURAL. The body builder has no way to reach the secret.

    This is the assertion that survives a future edit. If somebody adds a
    `passphrase` parameter here — for a "just in case the customer asks"
    template — this fails before the interpolation is ever written.
    """
    params = set(inspect.signature(rd.covering_note).parameters)
    for banned in ("passphrase", "password", "secret", "pass_phrase"):
        assert banned not in params, (
            f"`covering_note` now takes `{banned}`. The passphrase must never "
            f"be reachable from the thing that builds the email body — that is "
            f"the whole reason the owner's choice of an encrypted PDF is worth "
            f"anything over mailing the report itself.")


def test_the_passphrase_is_in_no_branch_of_the_email():
    """BEHAVIOURAL, over every branch — including the failure ones, which is
    where a debug interpolation would be added."""
    for delivery in (
        rd.decide(_pdf(), "<p>x</p>", PASSPHRASE),
        rd.decide(_pdf(), "<p>x</p>", ""),
        rd.decide(_pdf(), "<p>x</p>", PASSPHRASE, limit=10),
        rd.decide(None, "<p>x</p>", PASSPHRASE),
    ):
        html = rd.covering_note(delivery=delivery, **NOTE_ARGS)
        assert PASSPHRASE not in html, f"leaked on the {delivery.mode} branch"
        assert delivery.reason == "" or PASSPHRASE not in delivery.reason


def test_the_email_says_where_the_passphrase_is_without_saying_what_it_is():
    """A recipient handed an encrypted PDF and no way to find the key just has
    a file they cannot open. The mail names the SCREEN."""
    d = rd.decide(_pdf(), "<p>x</p>", PASSPHRASE)
    html = rd.covering_note(delivery=d, **NOTE_ARGS)
    assert "report" in html.lower() and "passphrase" in html.lower()
    assert "Settings" in html and "Organisation" in html
    assert "not in this email" in html


def test_the_passphrase_is_never_written_to_a_log(caplog):
    """`load_passphrase` logs the FACT of an unreadable value, never the value,
    and `decide` logs the exception TYPE, never the input."""
    caplog.set_level(logging.DEBUG)
    rd.decide(b"not a pdf at all", "<p>x</p>", PASSPHRASE)
    joined = " ".join(r.getMessage() for r in caplog.records)
    assert PASSPHRASE not in joined, joined


# ═════════════════════════════════════════════════════════════════════════════
# THE ENCRYPTION IS REAL
# ═════════════════════════════════════════════════════════════════════════════

def test_the_encrypted_document_refuses_to_open_without_the_passphrase():
    """Proved by reading it back, not by trusting the call returned."""
    from pypdf import PdfReader
    from pypdf.errors import FileNotDecryptedError

    enc = rd.encrypt_pdf(_pdf(), PASSPHRASE)
    r = PdfReader(io.BytesIO(enc))
    assert r.is_encrypted
    with pytest.raises(FileNotDecryptedError):
        _ = r.pages[0]

    wrong = PdfReader(io.BytesIO(enc))
    assert wrong.decrypt("not the passphrase") == 0

    right = PdfReader(io.BytesIO(enc))
    assert right.decrypt(PASSPHRASE)
    assert len(right.pages) == 1


def test_encrypting_with_an_empty_passphrase_is_refused_not_performed():
    """⚠ `PdfWriter.encrypt("")` SUCCEEDS and produces a document that opens
    with no password — an unencrypted report wearing the word 'encrypted'.
    That is the silent downgrade this whole module exists to make impossible,
    so it is refused at the function rather than guarded at one call site."""
    with pytest.raises(ValueError, match="empty passphrase"):
        rd.encrypt_pdf(_pdf(), "")
    with pytest.raises(ValueError, match="empty document"):
        rd.encrypt_pdf(b"", PASSPHRASE)


def test_the_algorithm_is_aes_256_and_the_pinned_pypdf_accepts_it():
    """`pypdf==6.14.2` is already in requirements.txt for the eSign signature
    bind, so this feature added NO dependency — but the algorithm name is a
    string the library validates at call time, and a version bump could retire
    it. Asserted against the real signature rather than assumed."""
    from pypdf import PdfWriter

    assert rd.PDF_ALGORITHM == "AES-256"
    assert "algorithm" in inspect.signature(PdfWriter.encrypt).parameters


# ═════════════════════════════════════════════════════════════════════════════
# THE SIZE GUARD
# ═════════════════════════════════════════════════════════════════════════════

def test_the_ses_v1_ceiling_is_ten_megabytes_after_base64():
    """Read from AWS's published quotas 2026-08-29, marked Adjustable: No, for
    the v1 API — which is what `ses_client.send_raw_email` is. SES v2 and SMTP
    are 40 MB and this product does not use them."""
    assert rd.SES_V1_MAX_ENCODED_BYTES == 10 * 1024 * 1024


def test_our_budget_sits_under_the_providers_and_cannot_be_raised_above_it(
        monkeypatch):
    """A ceiling above SES's own hard refusal is a guard that can never fire
    before the provider does, which is a guard that does nothing."""
    monkeypatch.delenv("REPORT_MAX_ENCODED_BYTES", raising=False)
    assert rd.max_encoded_bytes() < rd.SES_V1_MAX_ENCODED_BYTES

    monkeypatch.setenv("REPORT_MAX_ENCODED_BYTES", str(50 * 1024 * 1024))
    assert rd.max_encoded_bytes() == rd.SES_V1_MAX_ENCODED_BYTES

    monkeypatch.setenv("REPORT_MAX_ENCODED_BYTES", "3000000")
    assert rd.max_encoded_bytes() == 3_000_000


def test_an_unparseable_or_zero_limit_does_not_disable_the_check(monkeypatch):
    """"No limit" must never be reachable by typing the variable wrongly."""
    for bad in ("", "   ", "lots", "0", "-1"):
        monkeypatch.setenv("REPORT_MAX_ENCODED_BYTES", bad)
        assert rd.max_encoded_bytes() > 0


def test_the_size_counts_base64_inflation_not_the_raw_file():
    """`len(pdf_bytes)` stood in the payslip sender once and was ~30% short on
    every message. The wire figure has to be bigger than the file."""
    pdf = _pdf(filler=20_000)
    assert rd.encoded_message_bytes(pdf, "<p>x</p>") > len(pdf) * 1.3


def test_the_ceiling_is_measured_on_the_encrypted_document():
    """THE MUTATION THIS FILE EXISTS FOR.

    AES-256 inflates the document — measured on a real Unicode finance report,
    18,970 B in and 25,823 B out. So the limit here is set BETWEEN the encoded
    size of the plain PDF and the encoded size of the encrypted one. An
    implementation that measures the plain bytes attaches; the correct one
    refuses. There is no way to satisfy both.
    """
    pdf = _pdf(filler=30_000)
    note = "<p>x</p>"
    plain_encoded = rd.encoded_message_bytes(pdf, note)
    encrypted_encoded = rd.encoded_message_bytes(
        rd.encrypt_pdf(pdf, PASSPHRASE), note)
    assert encrypted_encoded > plain_encoded, (
        "the fixture no longer inflates under encryption, so this test can no "
        "longer tell the two implementations apart — pick a different filler")

    between = (plain_encoded + encrypted_encoded) // 2
    d = rd.decide(pdf, note, PASSPHRASE, limit=between)
    assert d.mode == rd.MODE_LINK_TOO_LARGE, (
        "the guard measured the PLAIN document. The encrypted one is what "
        "travels, and it is over the limit.")
    assert d.encoded_bytes == encrypted_encoded


def test_an_oversized_report_is_refused_in_words_and_never_truncated():
    d = rd.decide(_pdf(filler=5_000), "<p>x</p>", PASSPHRASE, limit=1_000)
    assert d.mode == rd.MODE_LINK_TOO_LARGE
    assert d.pdf is None, "a truncated or partial attachment is worse than none"
    assert "NOT been attached" in d.reason
    assert "Open it in Kartavaya" in d.reason
    # The size is stated so a reader knows whether to shorten the period.
    assert "KB" in d.reason or "MB" in d.reason


# ═════════════════════════════════════════════════════════════════════════════
# THE DECISION, BRANCH BY BRANCH
# ═════════════════════════════════════════════════════════════════════════════

def test_no_passphrase_sends_a_link_and_says_so_rather_than_sending_a_pdf():
    """DECIDED, not defaulted. Refusing to dispatch produces a `failed` row
    nobody reads — this product ran seven schedules that "had never dispatched
    once" while nobody noticed. The link branch discloses LESS than the code it
    replaced (which mailed the whole report in the body) and tells the one
    person who can fix it how."""
    d = rd.decide(_pdf(), "<p>x</p>", "")
    assert d.mode == rd.MODE_LINK_NO_PASSPHRASE
    assert d.pdf is None
    assert not d.attaches
    assert "NOT been attached" in d.reason
    assert "Settings" in d.reason and "Reports" in d.reason


def test_every_non_attaching_branch_is_in_link_modes():
    """A caller testing `mode == MODE_ENCRYPTED_PDF` in three places forgets
    the branch added next month. The set is the single question."""
    for pdf, passphrase, limit in ((None, PASSPHRASE, None),
                                   (_pdf(), "", None),
                                   (_pdf(), PASSPHRASE, 10)):
        d = rd.decide(pdf, "<p>x</p>", passphrase, limit=limit)
        assert not d.attaches
        assert d.mode in rd.LINK_MODES
        assert d.pdf is None
    ok = rd.decide(_pdf(), "<p>x</p>", PASSPHRASE)
    assert ok.attaches and ok.mode not in rd.LINK_MODES and ok.pdf


def test_a_corrupt_document_degrades_instead_of_killing_the_schedule():
    d = rd.decide(b"this is not a pdf", "<p>x</p>", PASSPHRASE)
    assert d.mode in rd.LINK_MODES
    assert d.pdf is None


def test_the_reason_reaches_the_recipient_on_every_link_branch():
    """A recipient who gets no attachment and no explanation assumes the report
    is broken. The reason is printed, not merely logged."""
    for pdf, passphrase, limit in ((None, PASSPHRASE, None),
                                   (_pdf(), "", None),
                                   (_pdf(), PASSPHRASE, 10)):
        d = rd.decide(pdf, "<p>x</p>", passphrase, limit=limit)
        html = rd.covering_note(delivery=d, **NOTE_ARGS)
        assert d.reason.split(" ")[0] in html
        assert "not attached to this email" in html


# ═════════════════════════════════════════════════════════════════════════════
# THE TEMPLATE
# ═════════════════════════════════════════════════════════════════════════════

def test_user_typed_fields_are_escaped_in_the_body():
    """`CLAUDE.md`: user-controlled fields are escaped at the `email_service`
    choke points. A schedule's name and an org's name are both customer free
    text, and this template carries both."""
    args = dict(NOTE_ARGS)
    args["report_name"] = '<script>alert("x")</script>'
    args["org"] = {"name": "<img src=x onerror=1>"}
    html = rd.covering_note(
        delivery=rd.decide(_pdf(), "<p>x</p>", PASSPHRASE), **args)
    assert "<script>" not in html
    assert "<img src=x" not in html
    assert "&lt;script&gt;" in html


def test_the_filename_carries_nothing_a_customer_typed():
    """A filename survives forwarding, saving and indexing, and it is the one
    part of an encrypted document that is never encrypted. `label` comes from
    the server-side `MODULE_TITLES` map, never from the schedule's name."""
    name = rd.filename("Finance", "2026-08-23", "2026-08-29")
    assert name == "Kartavaya-Finance-report-2026-08-23-2026-08-29.pdf"
    assert "/" not in rd.filename("../../etc/passwd", "a", "b")
    assert "\\" not in rd.filename("a\\b", "a", "b")


def test_the_skipped_recipient_count_is_said_in_the_mail():
    """`member_recipients` returns the count precisely so a caller can SAY it —
    "the skipped count is returned so the caller can SAY it; a recipient
    silently dropped reads as a send that failed" — and until now nobody did."""
    d = rd.decide(_pdf(), "<p>x</p>", PASSPHRASE)
    html = rd.covering_note(delivery=d, skipped_recipients=3, **NOTE_ARGS)
    assert "3 address(es)" in html
    quiet = rd.covering_note(delivery=d, **NOTE_ARGS)
    assert "address(es)" not in quiet


# ═════════════════════════════════════════════════════════════════════════════
# THE VALIDATION
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("value,ok", [
    ("a-long-enough-passphrase", True),
    ("short", False),
    ("", False),
    (None, False),
    (" leading-and-trailing-space ", False),
    ("has\na-newline-in-it-here", False),
    ("x" * (rd.PASSPHRASE_MAX_LENGTH + 1), False),
    ("x" * rd.PASSPHRASE_MIN_LENGTH, True),
])
def test_passphrase_validation(value, ok):
    assert (rd.passphrase_problem(value) == "") is ok


def test_whitespace_is_rejected_rather_than_trimmed():
    """A trimmed value saved is a different string from the one the person
    typed, and they will type what they typed when they open the PDF."""
    problem = rd.passphrase_problem(" a-long-enough-passphrase ")
    assert "space" in problem
