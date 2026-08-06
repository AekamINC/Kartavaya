"""Six demo agreements, one PDF between them.

Measured 2026-08-06 against the live database: of the 20 e-sign documents in the
Unicode Group demo organisation, six pointed at
`esign/originals/3ff1ede5f1274441b4e88eb8b4cb66d1.pdf`. A buyer opening the
Engagement Letter and then the NDA saw the same page twice.

These tests do not touch the database — the repointing is done by
`scripts/place_demo_esign_pdfs.py`, which can only run where R2 is reachable. What
is testable here is the generator, and the two properties that matter: the files
are real PDFs a reader can open, and no two of them are the same file. The second
one is the whole point.
"""
import hashlib
import importlib.util
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
GEN = BACKEND / "scripts" / "make_demo_esign_pdfs.py"


def _gen():
    spec = importlib.util.spec_from_file_location("make_demo_esign_pdfs", GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def pdfs():
    mod = _gen()
    return {
        d["slug"]: mod.build_pdf(d["title"], d["subtitle"], d["clauses"], mod.SIGNATURE)
        for d in mod.DOCS
    }


def test_there_are_five_and_no_two_are_the_same_file(pdfs):
    """The defect, stated as a property. Six titles sharing one file failed this."""
    assert len(pdfs) == 5, sorted(pdfs)
    hashes = {slug: hashlib.sha256(b).hexdigest() for slug, b in pdfs.items()}
    assert len(set(hashes.values())) == 5, (
        f"two demo agreements are byte-identical: {hashes}"
    )


def test_every_file_opens_and_has_one_half_height_page(pdfs):
    """"It generated a file" is not evidence the file is right — open it.

    E-sign has form here: it reported success while producing no signed PDF at
    all, and 34 generated images were invisible in the output.
    """
    from pypdf import PdfReader
    import io

    for slug, data in pdfs.items():
        reader = PdfReader(io.BytesIO(data))
        assert len(reader.pages) == 1, f"{slug} is not one page"
        box = reader.pages[0].mediabox
        assert (int(box.width), int(box.height)) == (595, 421), (
            f"{slug} is {box.width}x{box.height}, not half of A4"
        )


def test_the_text_is_actually_extractable_and_is_the_right_document(pdfs):
    """Text-only was the brief, so the text must survive the round trip."""
    from pypdf import PdfReader
    import io

    expect = {
        "engagement-letter-statutory-audit": "Statutory Audit",
        "non-disclosure-agreement": "Non-Disclosure Agreement",
        "virtual-cfo-services-agreement": "Virtual CFO",
        "erp-support-statement-of-work": "ERP Support",
        "payroll-outsourcing-agreement": "Payroll Outsourcing",
    }
    for slug, data in pdfs.items():
        text = PdfReader(io.BytesIO(data)).pages[0].extract_text()
        assert expect[slug] in text, f"{slug} does not read as its own title"
        assert "Authorised signatory" in text, f"{slug} has nowhere to sign"
        assert len(text) > 700, f"{slug} is nearly empty: {len(text)} chars"


def test_no_images_are_embedded(pdfs):
    """"no image only txt" — the brief, verbatim. An XObject would break it."""
    for slug, data in pdfs.items():
        assert b"/Image" not in data, f"{slug} embeds an image"
        assert b"/XObject" not in data, f"{slug} embeds an XObject"


def test_generation_is_deterministic(pdfs):
    """A creation timestamp would invalidate the hash the repoint script pins.

    `sign_documents.file_hash` is NOT NULL and the script writes the sha256 of
    these exact bytes. If the generator embedded a date, every run would produce a
    document whose stored hash no longer described it — which is the same class of
    lie as six titles sharing one file.
    """
    mod = _gen()
    again = {
        d["slug"]: mod.build_pdf(d["title"], d["subtitle"], d["clauses"], mod.SIGNATURE)
        for d in mod.DOCS
    }
    assert again == pdfs, "the generator does not produce stable bytes"

    for slug, data in pdfs.items():
        assert b"CreationDate" not in data, f"{slug} embeds a timestamp"


def test_every_repoint_target_has_a_generated_file():
    """The two scripts must agree, or the repoint silently skips a document."""
    spec = importlib.util.spec_from_file_location(
        "place_demo_esign_pdfs", BACKEND / "scripts" / "place_demo_esign_pdfs.py")
    place = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(place)

    slugs = {d["slug"] for d in _gen().DOCS}
    assert set(place.TARGETS) == slugs, (
        f"repoint targets {sorted(set(place.TARGETS) ^ slugs)} have no generated PDF"
    )
    titles = [t for ts in place.TARGETS.values() for t in ts]
    assert len(titles) == len(set(titles)), "a title is claimed by two different PDFs"
    assert len(titles) == 6, (
        f"six documents shared one PDF; {len(titles)} are targeted for repointing"
    )
