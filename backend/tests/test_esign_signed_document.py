"""The executed document — the artefact the e-sign module exists to produce.

For as long as the module has existed it produced none. `_generate_signed_certificate`
serialised the audit trail to JSON, uploaded it as `certificate-<id>.json` with
content type `application/json`, and wrote that object into the columns named
`signed_file_key` / `signed_file_url`. The UI offered it as "Signing certificate".
The original PDF and the collected signatures were never combined anywhere, and
11 of 27 completed documents in the live data had even that much.

Three properties are pinned here, each one a thing that was wrong or could
quietly become wrong again:

  1. **The signed artefact is a PDF and contains the pages that were signed.**
     Asserted on the bytes — `%PDF-` and a page count that is original + 1 —
     because "we call it signed_file_key" is exactly the assumption that failed.

  2. **`signature_data` is untrusted.** It arrives from an unauthenticated
     endpoint held by a client's client. A URL in it must never reach an
     `<img src>`, or WeasyPrint turns a stored string into an outbound fetch
     from the server at render time; script text must come out escaped.

  3. **Generation cannot break the signature that triggered it.** By the time
     the artefacts are built the signer's row is committed and the document is
     complete. A PDF failure that 500s the request invites the signer to sign
     again — so completion swallows and logs, and the rebuild endpoint exists
     to finish the job later.
"""
import io
import uuid
from datetime import datetime, timezone

import pytest

import routers.esign as esign
from services import esign_signed_doc as SD


ORG = {"name": "Aekam Inc", "gstin": "24AABCA1234A1Z5", "pan": "AABCA1234A",
       "billing_address": {"city": "Ahmedabad", "state": "Gujarat"}}
DOC = {"id": uuid.UUID("00000000-0000-0000-0000-0000000000dd"),
       "title": "Master Services Agreement", "file_hash": "b" * 64,
       "completed_at": datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)}
SIGNERS = [
    {"name": "Asha Rao", "email": "asha@example.invalid", "signature_type": "type",
     "signature_data": "Asha Rao", "signed_at": DOC["completed_at"],
     "signed_ip": "203.0.113.9", "otp_verified": True},
    {"name": "Vikram Nair", "email": "vikram@example.invalid", "signature_type": "type",
     "signature_data": "Vikram Nair", "signed_at": DOC["completed_at"],
     "signed_ip": "203.0.113.10", "otp_verified": False},
]

# A 1×1 transparent PNG — the smallest thing that is genuinely a drawn signature.
PNG_B64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEh"
           "QGAhKmMIQAAAABJRU5ErkJggg==")


def _pdf(pages: int) -> bytes:
    from pypdf import PdfWriter
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def _page_count(data: bytes) -> int:
    from pypdf import PdfReader
    return len(PdfReader(io.BytesIO(data)).pages)


def _fake_render(monkeypatch, pages: int = 1):
    """Stand in for WeasyPrint, which has no native stack in CI.

    Returns a real one-page PDF so the MERGE is exercised for real — the part
    that was missing is the binding, not the typesetting.
    """
    captured = {}

    def _render(html_str):
        captured["html"] = html_str
        return _pdf(pages)

    monkeypatch.setattr(SD.R, "render_pdf", _render)
    return captured


# ── 1 · the artefact is the document ──────────────────────────────────────────

def test_the_signed_artefact_is_a_pdf_carrying_the_original_pages(monkeypatch):
    _fake_render(monkeypatch)
    original = _pdf(3)

    out, appended = SD.build_signed_pdf(ORG, DOC, SIGNERS, original, "msa.pdf")

    assert appended is True
    assert out[:5] == b"%PDF-", "the signed artefact must be a PDF, not JSON"
    assert _page_count(out) == 4, "original pages plus one signature page"


def test_a_non_pdf_original_degrades_to_the_signature_page_and_says_so(monkeypatch):
    cap = _fake_render(monkeypatch)

    out, appended = SD.build_signed_pdf(ORG, DOC, SIGNERS, b"PK\x03\x04zip", "offer.docx")

    assert appended is False
    assert _page_count(out) == 1
    assert "not reproduced here" in cap["html"]
    assert "offer.docx" in cap["html"], "name the file that was actually signed"


def test_a_corrupt_original_does_not_claim_pages_it_does_not_carry(monkeypatch):
    cap = _fake_render(monkeypatch)

    out, appended = SD.build_signed_pdf(ORG, DOC, SIGNERS, b"%PDF-1.4 truncated", "msa.pdf")

    assert appended is False
    assert _page_count(out) == 1
    assert "not reproduced here" in cap["html"], \
        "the page must not say 'the pages preceding this one' when there are none"


def test_missing_weasyprint_raises_rather_than_writing_a_bogus_artefact(monkeypatch):
    def _boom(_html):
        raise RuntimeError("WeasyPrint is not available on this server")
    monkeypatch.setattr(SD.R, "render_pdf", _boom)

    with pytest.raises(RuntimeError):
        SD.build_signed_pdf(ORG, DOC, SIGNERS, _pdf(1), "msa.pdf")


def test_the_page_records_who_signed_when_and_how(monkeypatch):
    cap = _fake_render(monkeypatch)
    SD.build_signed_pdf(ORG, DOC, SIGNERS, _pdf(1), "msa.pdf")
    html = cap["html"]

    for signer in SIGNERS:
        assert signer["name"] in html
        assert signer["email"] in html
        assert signer["signed_ip"] in html
    assert "IST" in html, "timestamps in the reader's clock, not UTC"
    assert "Identity verified by one-time password" in html
    assert "Not verified by one-time password" in html, \
        "an unverified signer must not be shown as verified"
    assert DOC["file_hash"] in html, "the fingerprint is what makes alteration detectable"
    assert "10A" in html


def test_the_layout_uses_no_css_grid(monkeypatch):
    """doc_render's own rule: WeasyPrint's grid support is partial, and a grid
    that fails to apply collapses the columns while the page still renders."""
    cap = _fake_render(monkeypatch)
    SD.build_signed_pdf(ORG, DOC, SIGNERS, _pdf(1), "msa.pdf")
    assert "display:grid" not in cap["html"].replace(" ", "")


def test_an_odd_number_of_signatories_keeps_its_columns():
    html = SD.signer_grid([SIGNERS[0]], per_row=2)
    assert html.count("<td") == 2, "the row is padded so the column keeps its width"


# ── 2 · signature_data is hostile input ───────────────────────────────────────

@pytest.mark.parametrize(
    "data,kind",
    [
        ("https://attacker.invalid/track.png", "draw"),
        ("http://attacker.invalid/track.png", "draw"),
        ("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "draw"),
    ],
    ids=["https-url", "http-url", "svg-data-uri"],
)
def test_a_signature_that_is_not_a_raster_data_uri_is_never_put_in_an_img(data, kind):
    out = SD.signature_mark(data, kind)
    assert "<img" not in out
    assert "attacker.invalid" not in out, "a stored URL must not survive into the document"
    assert "svg" not in out.lower()


def test_a_typed_signature_is_escaped():
    out = SD.signature_mark("<script>fetch('//x')</script>", "type")
    assert "<script>" not in out
    assert "&lt;script&gt;" in out


def test_a_drawn_signature_is_reproduced():
    out = SD.signature_mark(f"data:image/png;base64,{PNG_B64}", "draw")
    assert out.startswith('<img class="esd-sig__img" src="data:image/png;base64,')


def test_an_oversized_signature_is_named_not_embedded():
    import base64
    huge = base64.b64encode(b"x" * (SD.MAX_SIGNATURE_BYTES + 1)).decode()
    out = SD.signature_mark(f"data:image/png;base64,{huge}", "draw")
    assert "<img" not in out, "one signer must not make the document unopenable"


def test_a_malformed_base64_payload_does_not_reach_an_img():
    out = SD.signature_mark("data:image/png;base64,!!!!not base64!!!!", "draw")
    assert "<img" not in out


def test_no_signature_leaves_a_blank_space_not_a_marker():
    assert SD.signature_mark("", "draw") == '<div class="esd-sig__blank"></div>'


# ── 3 · generation never breaks the signature ─────────────────────────────────

class _RecordingPool:
    def __init__(self):
        self.executed = []

    async def execute(self, q, *a, **k):
        self.executed.append((q, a))

    async def fetchrow(self, *a, **k):
        return None

    async def fetch(self, *a, **k):
        return []


@pytest.mark.asyncio
async def test_a_failed_pdf_does_not_raise_out_of_completion(monkeypatch):
    """The signer's row is already committed. A 500 here tells a signer who
    validly signed that it did not work, and invites them to sign again."""
    pool = _RecordingPool()

    async def _ok(*a, **k):
        return None

    async def _boom(*a, **k):
        raise RuntimeError("WeasyPrint is not available on this server")

    monkeypatch.setattr(esign, "_generate_signed_certificate", _ok)
    monkeypatch.setattr(esign, "_generate_signed_pdf", _boom)

    await esign._generate_completion_artefacts(pool, DOC["id"], "org")


@pytest.mark.asyncio
async def test_a_failed_certificate_does_not_stop_the_signed_pdf(monkeypatch):
    """They are independent artefacts and one must not take the other down."""
    pool = _RecordingPool()
    built = []

    async def _boom(*a, **k):
        raise RuntimeError("storage timeout")

    async def _pdf_ok(*a, **k):
        built.append(True)

    monkeypatch.setattr(esign, "_generate_signed_certificate", _boom)
    monkeypatch.setattr(esign, "_generate_signed_pdf", _pdf_ok)

    await esign._generate_completion_artefacts(pool, DOC["id"], "org")
    assert built == [True]


def test_the_certificate_no_longer_writes_the_signed_file_columns():
    """The regression, pinned at the source: the JSON certificate must land in
    certificate_file_*, never in signed_file_*."""
    import inspect
    src = inspect.getsource(esign._generate_signed_certificate)
    assert "certificate_file_key" in src
    assert "signed_file_key" not in src, \
        "the audit certificate is being written into the signed-document columns again"


def test_the_signed_pdf_writer_uploads_a_pdf_not_json():
    import inspect
    src = inspect.getsource(esign._generate_signed_pdf)
    assert 'content_type="application/pdf"' in src
    assert "signed_file_key=$1" in src
