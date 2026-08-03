"""The base64 fallback an org without R2 credentials actually runs on.

`storage.upload_file` has three backends: local disk, Cloudflare R2, and a
base64 `data:` URI when the org has no R2 credentials configured. That third one
is not a corner case — on staging it was TWO of the three orgs, including Aekam
Inc itself.

It returned `"key": None`. `sign_documents.file_key` is NOT NULL, and
`routers/esign.upload_document_file` writes `upload_result.get("key", "")` —
which returns **None**, not the default, because the key is present and holds
None. So every e-sign PDF upload 500'd for exactly those orgs, and since the
module cannot do anything without a PDF, e-sign was unusable for them.

Found by uploading a real PDF through the product's own form during Phase 0
verification. It is not visible in the code — `.get(k, default)` reads as
defensive — and it is not visible on an org that has R2. It is only visible in
the 500.
"""
import asyncio

import pytest

from services import storage


@pytest.fixture
def no_r2(monkeypatch):
    """An org with no R2 credentials — the fallback path."""
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)

    async def _none(org_id):
        return None, None

    monkeypatch.setattr(storage, "_get_org_r2", _none)


@pytest.mark.asyncio
async def test_the_fallback_returns_a_string_key_never_none(no_r2):
    out = await storage.upload_file(
        file_bytes=b"%PDF-1.4 hello", filename="a.pdf",
        content_type="application/pdf", user_id="u1", org_id="org1",
    )
    assert out["key"] is not None, \
        "None reaches SQL and violates the NOT NULL on sign_documents.file_key"
    assert isinstance(out["key"], str)


@pytest.mark.asyncio
async def test_the_key_is_still_falsy_so_existing_guards_are_unchanged(no_r2):
    """`if result.get("key")` in pahchan and uploads must behave as before."""
    out = await storage.upload_file(
        file_bytes=b"x", filename="a.png", content_type="image/png",
        user_id="u1", org_id="org1",
    )
    assert not out["key"]


@pytest.mark.asyncio
async def test_the_bytes_survive_the_round_trip(no_r2):
    """The fallback IS the storage for these orgs — a lossy one is worse than none."""
    payload = b"%PDF-1.4\nthree pages worth of bytes\n%%EOF\n"
    out = await storage.upload_file(
        file_bytes=payload, filename="doc.pdf",
        content_type="application/pdf", user_id="u1", org_id="org1",
    )
    assert out["url"].startswith("data:application/pdf;base64,")

    back = await storage.download_file(out["key"], "org1", out["url"])
    assert back == payload, "download_file cannot read back what upload_file wrote"


@pytest.mark.asyncio
async def test_download_reads_the_data_uri_when_there_is_no_key(no_r2):
    """`download_file` is called with the key first; for these orgs it is empty,
    so the URL has to be the fallback source or every derived artefact is blank."""
    out = await storage.upload_file(
        file_bytes=b"bytes", filename="f.bin", content_type="application/octet-stream",
        user_id="u1", org_id="org1",
    )
    assert await storage.download_file("", "org1", out["url"]) == b"bytes"
    assert await storage.download_file(None, "org1", out["url"]) == b"bytes"


@pytest.mark.asyncio
async def test_download_returns_none_rather_than_raising_on_nothing(no_r2):
    """A caller rebuilding a derived artefact should degrade, not 500."""
    assert await storage.download_file("", "org1", None) is None
    assert await storage.download_file("pending", "org1", "pending") is None
