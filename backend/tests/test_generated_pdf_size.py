"""What this product STORES, and how big it is allowed to be.

── Almost nothing it calls a PDF is a stored PDF

Nine modules render PDFs — invoices, payslips, reports, the cost pack, the
analytics pack, documents, subscriptions, admin. Not one of them calls
`upload_file`: every one renders from the row data on request and streams to
the browser. They occupy no bytes and are covered here only by the assertion
that this stays true.

E-sign is the exception and the whole of it. Three artefacts persist: the
uploaded original, the merged signed document, and a JSON certificate.

── The page we generate ourselves must stay in kilobytes

`MAX_SIGNATURE_BYTES` bounded ONE signature and nothing bounded the page. A
document may have up to ten signers (`create_document` enforces that), so ten
images just under the per-signature cap was ~5MB of embedded PNG in a page this
product writes itself. `_Budget` bounds the page.
"""
import base64
import re

import pytest

from services import esign_signed_doc as E


def _png(nbytes: int) -> str:
    """A data URI whose DECODED payload is nbytes."""
    return "data:image/png;base64," + base64.b64encode(b"\x89PNG" + b"\x00" * (nbytes - 4)).decode()


def _signers(n: int, size: int) -> list[dict]:
    return [
        {"name": f"Signer {i}", "email": f"s{i}@example.com", "signature_type": "draw",
         "signature_data": _png(size), "sign_order": i}
        for i in range(n)
    ]


def _embedded_bytes(html: str) -> int:
    """Total DECODED size of every image the page actually embeds."""
    return sum(
        len(base64.b64decode(m)) for m in re.findall(r'src="data:image/[a-z]+;base64,([^"]+)"', html)
    )


def test_one_signature_under_the_cap_is_reproduced():
    html = E.signature_mark(_png(40 * 1024), "draw")
    assert "<img" in html


def test_one_signature_over_the_cap_is_described_instead():
    html = E.signature_mark(_png(E.MAX_SIGNATURE_BYTES + 1), "draw")
    assert "<img" not in html
    assert "too large to reproduce" in html


def test_ten_signers_cannot_between_them_exceed_the_page_budget():
    """THE regression. Each of these is legal on its own; together they were 4MB."""
    html = E.signer_grid(_signers(10, 400 * 1024))
    assert _embedded_bytes(html) <= E.MAX_SIGNATURE_TOTAL_BYTES, (
        f"the page embedded {_embedded_bytes(html) // 1024}KB of signature image against a "
        f"{E.MAX_SIGNATURE_TOTAL_BYTES // 1024}KB budget"
    )


def test_the_page_budget_keeps_the_generated_page_in_kilobytes():
    html = E.signer_grid(_signers(10, 400 * 1024))
    assert len(html) < 1024 * 1024, "the signature page HTML alone is over a megabyte"


def test_the_earliest_signatories_are_the_ones_reproduced():
    """Spent in signing order — arbitrary, but stable and explainable."""
    html = E.signer_grid(_signers(10, 400 * 1024), per_row=1)
    first = html.index("Signer 0")
    assert "<img" in html[:first + 4000], "the first signatory's mark was dropped"


def test_a_dropped_signature_says_so_rather_than_rendering_blank():
    """A blank space reads as 'did not sign'. That is a worse lie than a note."""
    html = E.signer_grid(_signers(10, 400 * 1024))
    assert "not reproduced here" in html


def test_a_single_signer_is_unaffected_by_the_budget():
    """The common case must not regress: one signature, well under, still drawn."""
    html = E.signer_grid(_signers(1, 100 * 1024))
    assert "<img" in html
    assert "not reproduced" not in html


def test_signature_mark_without_a_budget_behaves_exactly_as_before():
    """Existing callers and tests pass two arguments. That path must not change."""
    assert "<img" in E.signature_mark(_png(400 * 1024), "draw")


# ── The upload cap ───────────────────────────────────────────────────────────

def test_the_esign_upload_cap_is_ten_megabytes():
    """
    The stored artefact is the original plus our signature page, so this number
    is very nearly the ceiling on what e-sign occupies. It was 20MB.
    """
    from routers import esign
    assert esign._MAX_PDF_BYTES == 10 * 1024 * 1024


def test_no_pdf_generator_stores_what_it_renders():
    """
    Nine modules render PDFs and stream them. If one ever starts storing, it
    joins the storage budget and this test should be the thing that says so.
    """
    import pathlib
    root = pathlib.Path(__file__).resolve().parent.parent
    generators = [
        "services/cost_report_pdf.py", "services/doc_render.py",
        "services/report_generator.py", "routers/dristi.py", "routers/ganit.py",
        "routers/reports.py", "routers/subscription.py", "routers/documents.py",
    ]
    for rel in generators:
        src = (root / rel).read_text(encoding="utf-8")
        assert "upload_file" not in src, (
            f"{rel} now stores a rendered PDF — it used to stream it. That is a new "
            "storage cost and a new thing to keep under a cap."
        )


# ── The attendance photo cap ─────────────────────────────────────────────────
#
# 768 KB, down from 4 MB. Both capture paths already compress on the device —
# ClockScreen resizes to 720px at JPEG q0.75 (~50-80 KB), EnrollScreen to 1080px
# at q0.85 (~150-300 KB) — and there is no web capture path at all, so 4 MB was
# never a bound on what arrives. It was 20-50x above it.

def test_the_attendance_photo_cap_is_in_kilobytes():
    from routers.pahchan import MAX_PHOTO_BYTES
    assert MAX_PHOTO_BYTES < 1024 * 1024, "an attendance photo cap in megabytes is not a cap"
    assert MAX_PHOTO_BYTES == 768 * 1024


def test_the_cap_leaves_room_for_a_real_enrolment_photo():
    """
    A 1080px q0.85 JPEG of a face runs 150-300 KB. If this cap ever drops near
    that, a worker cannot enrol — which is a worse outcome than a larger file,
    and the knob is the client resize rather than this number.
    """
    from routers.pahchan import MAX_PHOTO_BYTES
    assert MAX_PHOTO_BYTES >= 2 * 300 * 1024


def test_the_capture_paths_still_write_jpeg_not_png():
    """
    PNG is lossless and made for flat graphics. The same 720px face as PNG is
    roughly 8-15x LARGER than as JPEG — asking for PNG to save space achieves
    the opposite. The server cap above assumes both paths keep writing JPEG.
    """
    import pathlib
    mobile = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "src" / "screens" / "pahchan"
    for name in ("ClockScreen.tsx", "EnrollScreen.tsx"):
        src = (mobile / name).read_text(encoding="utf-8")
        assert "SaveFormat.JPEG" in src, f"{name} no longer encodes JPEG"
        assert "SaveFormat.PNG" not in src, (
            f"{name} encodes PNG — for a camera frame that is 8-15x larger, "
            "and the server cap is set for JPEG"
        )


# ── The merge, made smaller losslessly ───────────────────────────────────────

def _doc(n_pages: int) -> bytes:
    """Pages sharing one large, identical content stream — what a merge duplicates."""
    import io
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, NameObject

    w = PdfWriter()
    body = ("BT /F1 12 Tf 50 700 Td (" + "Kartavaya contract clause. " * 300 + ") Tj ET").encode()
    for _ in range(n_pages):
        w.add_blank_page(width=595, height=842)
    for page in w.pages:
        st = DecodedStreamObject()
        st.set_data(body)
        page[NameObject("/Contents")] = w._add_object(st)
    b = io.BytesIO()
    w.write(b)
    return b.getvalue()


def test_the_merge_preserves_every_page():
    """Compression must never cost a page. This is the assertion that outranks size."""
    import io
    from pypdf import PdfReader
    merged = E.append_pages(_doc(4), _doc(1))
    assert len(PdfReader(io.BytesIO(merged)).pages) == 5


def test_the_merge_collapses_objects_the_two_documents_share():
    """
    Measured, not assumed: 4+1 pages over one repeated content stream went from
    42,018 to 9,281 bytes. A merge is precisely the operation that creates
    duplicate fonts, logos and colour profiles, so this is where dedup pays.
    """
    import io
    from pypdf import PdfReader, PdfWriter

    a, b = _doc(4), _doc(1)
    plain = PdfWriter()
    for src in (a, b):
        for p in PdfReader(io.BytesIO(src)).pages:
            plain.add_page(p)
    out = io.BytesIO()
    plain.write(out)

    assert len(E.append_pages(a, b)) < len(out.getvalue()), \
        "append_pages is no smaller than an undeduped merge — compression was dropped"


def test_a_merge_that_cannot_be_compressed_still_produces_a_document(monkeypatch):
    """
    Best-effort. An optimisation must never turn a signable document into a
    failure — the executed PDF is worth more than the bytes it saves.
    """
    import io
    from pypdf import PdfWriter, PdfReader

    def boom(self, *a, **k):
        raise RuntimeError("malformed xref")

    monkeypatch.setattr(PdfWriter, "compress_identical_objects", boom)
    merged = E.append_pages(_doc(2), _doc(1))
    assert len(PdfReader(io.BytesIO(merged)).pages) == 3
