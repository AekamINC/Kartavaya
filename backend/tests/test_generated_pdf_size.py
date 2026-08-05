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
