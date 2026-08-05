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
    """An org with no R2 credentials AND no platform bucket — the last resort.

    Both halves matter now. `upload_file` no longer reaches base64 just because
    the org has no credentials: it tries the vendor's own bucket first, which is
    what stops a file landing in a database row. So this fixture has to remove
    the platform bucket too, or these tests would be asserting the base64 shape
    against a path that never runs.

    `_platform_cache` is a module-level cache, so it is cleared on the way in
    AND on the way out — a test that leaves a client in it would silently decide
    the outcome of the next one.
    """
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)

    async def _none(org_id):
        return None, None

    monkeypatch.setattr(storage, "_get_org_r2", _none)
    for var in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"):
        monkeypatch.delenv(var, raising=False)
    storage._platform_cache.clear()
    yield
    storage._platform_cache.clear()


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


# ── The platform bucket ──────────────────────────────────────────────────────
#
# Everything above describes the base64 fallback as the storage those orgs run
# on. It was, and it cost 32MB of `public.tasks` — six rows, one of them a 14MB
# mp4, together 45% of the whole database. The fallback is now the LAST resort
# rather than the second one: an org with no credentials of its own goes to the
# vendor's bucket, whose four environment variables were set on Railway the
# entire time and read only by a startup log line.
#
# MUTATION-CHECKED. Removing the `_resolve_r2` platform branch turns
# `test_an_org_without_its_own_bucket_does_not_write_to_the_database` red;
# dropping the prefix turns the key test red; making `sign_key` resolve by the
# org instead of by the key turns the migration test red.

class _FakeClient:
    """Records what it was asked to store, and signs a URL you can assert on."""

    def __init__(self, name):
        self.name = name
        self.puts = []

    def put_object(self, Bucket, Key, Body, ContentType):
        self.puts.append({"bucket": Bucket, "key": Key, "bytes": len(Body)})

    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://{self.name}.example/{Params['Bucket']}/{Params['Key']}"


@pytest.fixture
def platform_only(monkeypatch):
    """No org bucket, but the vendor's bucket IS configured."""
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)

    async def _none(org_id):
        return None, None

    monkeypatch.setattr(storage, "_get_org_r2", _none)
    client = _FakeClient("platform")
    storage._platform_cache.clear()
    storage._platform_cache.append((client, "kartavaya-platform"))
    yield client
    storage._platform_cache.clear()


@pytest.mark.asyncio
async def test_an_org_without_its_own_bucket_does_not_write_to_the_database(platform_only):
    """THE regression. A 14MB video must not come back as a data URI."""
    out = await storage.upload_file(
        file_bytes=b"\x00" * 4096, filename="site-visit.mp4",
        content_type="video/mp4", user_id="u1", org_id="org1",
    )
    assert not out["url"].startswith("data:"), \
        "an org with no credentials of its own put the file in the database row again"
    assert out["bucket"] == "kartavaya-platform"
    assert platform_only.puts and platform_only.puts[0]["bytes"] == 4096


@pytest.mark.asyncio
async def test_the_key_says_which_bucket_holds_it(platform_only):
    """`org/<id>/…` is not decoration — sign_key reads it. See the next test."""
    out = await storage.upload_file(
        file_bytes=b"x", filename="a.png", content_type="image/png",
        user_id="u1", org_id="org1",
    )
    assert out["key"].startswith("org/org1/")
    assert platform_only.puts[0]["key"] == out["key"], \
        "the key stored in the database must be the key written to the bucket"


@pytest.mark.asyncio
async def test_a_file_stays_readable_after_the_org_brings_its_own_bucket(monkeypatch):
    """
    The hazard that makes the prefix worth having.

    An org uploads while it has no credentials, so the file lands in the
    platform bucket. Later someone fills in that org's Cloudflare details.
    Resolving by the ORG at read time would now sign every one of those old keys
    against a brand-new, empty bucket — a 404 for every previously working file,
    with nothing in the logs to say why. Resolving by the KEY keeps them.
    """
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)
    platform = _FakeClient("platform")
    storage._platform_cache.clear()
    storage._platform_cache.append((platform, "kartavaya-platform"))

    # The org now HAS its own bucket.
    own = _FakeClient("own")

    async def _own(org_id):
        return own, "org1-bucket"

    monkeypatch.setattr(storage, "_get_org_r2", _own)

    old = await storage.sign_key("org1", "org/org1/abc.png")   # written before
    new = await storage.sign_key("org1", "personal/u1/def.png")  # written after

    assert "kartavaya-platform" in old, "an old file was signed against the new empty bucket"
    assert "org1-bucket" in new, "a new file must go to the org's own bucket"
    storage._platform_cache.clear()


@pytest.mark.asyncio
async def test_the_org_bucket_is_still_preferred_and_takes_no_prefix(monkeypatch):
    """Per-org R2 is the design; the platform bucket is the safety net, not a move."""
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)
    own = _FakeClient("own")

    async def _own(org_id):
        return own, "org1-bucket"

    monkeypatch.setattr(storage, "_get_org_r2", _own)
    storage._platform_cache.clear()
    storage._platform_cache.append((_FakeClient("platform"), "kartavaya-platform"))

    out = await storage.upload_file(
        file_bytes=b"x", filename="a.png", content_type="image/png",
        user_id="u1", org_id="org1",
    )
    assert out["bucket"] == "org1-bucket"
    assert not out["key"].startswith("org/"), \
        "an org's own bucket needs no namespace and must not gain one"
    storage._platform_cache.clear()
