"""There is no third backend any more. An upload with nowhere to go is refused.

`storage.upload_file` had three: local disk, Cloudflare R2, and a base64 `data:`
URI when no bucket resolved. That third one was not a corner case — two of the
three orgs had no R2 credentials of their own, Aekam Inc among them, so the
vendor's own uploads took it. Every caller then wrote the returned string into
its column. Eleven files accumulated that way — four screen recordings, two
screenshots, five executed e-sign PDFs, 99 MB — and the database sat at 82 MB
until they were moved to R2 on 2026-08-19, after which it was 49 MB.

Every screen reported success the whole time. That is the property that makes
this worth a test file rather than a comment: the failure was invisible at the
only place anyone was looking.

WHAT THIS FILE USED TO ASSERT, and why the expectations moved. It pinned the
shape of that base64 return: that its key was `""` and not `None` (because
`None` violated the NOT NULL on `sign_documents.file_key` and 500'd every e-sign
upload for those two orgs), and that the bytes survived the round trip. Both
were true and both were worth pinning while the branch existed. The branch is
gone, so the tests below pin the thing that replaced it — a refusal that names
what is unset — plus the one guarantee that has not changed and must not: a
healthy upload behaves exactly as it did.
"""
import inspect

import pytest

from services import storage


@pytest.fixture
def no_bucket(monkeypatch):
    """No org bucket, no platform bucket, no local disk — nowhere to put a file.

    All three halves matter. `upload_file` reaches the refusal only after the
    org's own bucket AND the vendor's have both failed to resolve, and only when
    LOCAL_STORAGE_PATH is unset, so a fixture that removed fewer than three
    would be asserting against a path that never runs.

    `_platform_cache` is a module-level cache, so it is cleared on the way in AND
    on the way out — a test that leaves a client in it would silently decide the
    outcome of the next one.
    """
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)

    async def _none(org_id):
        return None, None

    monkeypatch.setattr(storage, "_get_org_r2", _none)
    for var in storage._PLATFORM_VARS:
        monkeypatch.delenv(var, raising=False)
    storage._platform_cache.clear()
    yield
    storage._platform_cache.clear()


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


@pytest.fixture
def own_bucket(monkeypatch):
    """The org has its own Cloudflare account. The primary path, and the design."""
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)
    own = _FakeClient("own")

    async def _own(org_id):
        return own, "org1-bucket"

    monkeypatch.setattr(storage, "_get_org_r2", _own)
    storage._platform_cache.clear()
    storage._platform_cache.append((_FakeClient("platform"), "kartavaya-platform"))
    yield own
    storage._platform_cache.clear()


@pytest.fixture
def local_disk(monkeypatch, tmp_path):
    """LOCAL_STORAGE_PATH — the dev backend, and the only one that is not R2."""
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", str(tmp_path))
    storage._platform_cache.clear()
    yield tmp_path
    storage._platform_cache.clear()


# ── The refusal ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_no_bucket_raises_instead_of_returning_the_file(no_bucket):
    """
    Was: assert the returned key is a string and never None.

    That test existed because the return value reached SQL. There is no return
    value now — an upload with nowhere to go fails, and failing is correct.
    Nothing can reach `sign_documents.file_key`, so nothing can violate it.
    """
    with pytest.raises(storage.StorageNotConfigured):
        await storage.upload_file(
            file_bytes=b"%PDF-1.4 hello", filename="a.pdf",
            content_type="application/pdf", user_id="u1", org_id="org1",
        )


@pytest.mark.asyncio
async def test_the_refusal_names_the_variables_that_are_unset(no_bucket):
    """An operator reading this has to know what to set. 'Upload failed' does not
    say whether it is credentials, quota, network or a bad file."""
    with pytest.raises(storage.StorageNotConfigured) as caught:
        await storage.upload_file(
            file_bytes=b"x", filename="a.png", content_type="image/png",
            user_id="u1", org_id="org1",
        )
    exc = caught.value
    assert exc.status_code == 503
    assert set(exc.missing) == set(storage._PLATFORM_VARS)
    for var in storage._PLATFORM_VARS:
        assert var in exc.detail, f"{var} is unset and the message does not say so"
    assert "not saved" in exc.detail, \
        "the caller must be told the file was not stored, not merely that something failed"


@pytest.mark.asyncio
async def test_it_names_only_the_ones_actually_missing(no_bucket, monkeypatch):
    """Half-configured is the likeliest real state — someone pasted three of four.
    Listing all four sends them to re-check the two that are already right."""
    monkeypatch.setenv("R2_ACCOUNT_ID", "acct")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "akid")
    storage._platform_cache.clear()

    with pytest.raises(storage.StorageNotConfigured) as caught:
        await storage.upload_file(
            file_bytes=b"x", filename="a.png", content_type="image/png",
            user_id="u1", org_id="org1",
        )
    exc = caught.value
    assert exc.missing == ["R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
    assert "R2_ACCOUNT_ID" not in exc.detail


@pytest.mark.asyncio
async def test_all_four_set_but_unusable_says_so_instead_of_listing_nothing(monkeypatch):
    """
    A wrong value is not a missing one, and the fix is different. If the four are
    present and a client still will not build — `_platform_r2` catches that and
    caches (None, None) — then `missing` is empty, and a message built from an
    empty list would read as a sentence with a hole in it.
    """
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)

    async def _none(org_id):
        return None, None

    monkeypatch.setattr(storage, "_get_org_r2", _none)
    for var in storage._PLATFORM_VARS:
        monkeypatch.setenv(var, "present-but-wrong")
    storage._platform_cache.clear()
    storage._platform_cache.append((None, None))   # what _platform_r2 caches on a build failure

    with pytest.raises(storage.StorageNotConfigured) as caught:
        await storage.upload_file(
            file_bytes=b"x", filename="a.png", content_type="image/png",
            user_id="u1", org_id="org1",
        )
    assert caught.value.missing == []
    assert "no storage client could be built" in caught.value.detail
    storage._platform_cache.clear()


@pytest.mark.asyncio
async def test_the_refusal_is_a_503_so_a_bare_caller_does_not_500(no_bucket):
    """
    Three call sites do not wrap the call — `esign.upload_document_file`,
    the task-attachment route in server.py, and `ai_router.generate_image`.
    Those are the ones that must not answer 500, because a 500 tells the user
    nothing and tells the operator nothing either. Raising an HTTPException means
    they answer 503 with the message above without any of them being edited.
    """
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as caught:
        await storage.upload_file(
            file_bytes=b"x", filename="a.png", content_type="image/png",
            user_id="u1", org_id="org1",
        )
    assert caught.value.status_code == 503


# ── The ratchet ──────────────────────────────────────────────────────────────
#
# The rule this file exists to keep true, after everyone has forgotten why: a
# column holds a KEY, never bytes. The two tests below are the ones that have to
# fail if somebody reintroduces the convenience of "just put it in the row".


@pytest.mark.asyncio
async def test_no_configuration_can_produce_a_data_uri(
    monkeypatch, tmp_path, no_bucket,
):
    """
    THE RATCHET. Every configuration `upload_file` supports, in one place, each
    asserted not to return bytes in the URL. A new backend added later without a
    line here is the only way past it.

    The no-bucket case is included as a raise: a call that cannot return also
    cannot return a data URI, and stating it here keeps the enumeration complete
    rather than leaving the dangerous configuration to a different test.
    """
    async def _none(org_id):
        return None, None

    with pytest.raises(storage.StorageNotConfigured):
        await storage.upload_file(
            file_bytes=b"x" * 64, filename="v.mp4", content_type="video/mp4",
            user_id="u1", org_id="org1",
        )

    # local disk
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", str(tmp_path))
    out = await storage.upload_file(
        file_bytes=b"x" * 64, filename="v.mp4", content_type="video/mp4",
        user_id="u1", org_id="org1",
    )
    assert not out["url"].startswith("data:"), "local disk returned the bytes inline"

    # the platform bucket
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)
    monkeypatch.setattr(storage, "_get_org_r2", _none)
    storage._platform_cache.clear()
    storage._platform_cache.append((_FakeClient("platform"), "kartavaya-platform"))
    out = await storage.upload_file(
        file_bytes=b"x" * 64, filename="v.mp4", content_type="video/mp4",
        user_id="u1", org_id="org1",
    )
    assert not out["url"].startswith("data:"), "the platform bucket returned the bytes inline"

    # the org's own bucket
    own = _FakeClient("own")

    async def _own(org_id):
        return own, "org1-bucket"

    monkeypatch.setattr(storage, "_get_org_r2", _own)
    out = await storage.upload_file(
        file_bytes=b"x" * 64, filename="v.mp4", content_type="video/mp4",
        user_id="u1", org_id="org1",
    )
    assert not out["url"].startswith("data:"), "the org bucket returned the bytes inline"
    storage._platform_cache.clear()


def test_upload_file_cannot_encode_anything():
    """
    The same rule read off the source, because a configuration nobody thought to
    enumerate above would slip past the test that enumerates them. `upload_file`
    has no legitimate reason to hold a base64 encoder or to build a `data:`
    string — `download_file` decodes legacy values and that is deliberate, so
    this is scoped to the writer alone.
    """
    src = inspect.getsource(storage.upload_file)
    assert "b64encode" not in src, \
        "upload_file is encoding again — a file belongs in a bucket, not a column"
    assert "data:" not in src, \
        "upload_file is building a data URI again"


# ── A healthy upload is untouched ────────────────────────────────────────────
#
# Nothing above is worth anything if it changed what a working upload does. R2
# works today; these pin that it still does.


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
async def test_the_org_bucket_is_still_preferred_and_takes_no_prefix(own_bucket):
    """Per-org R2 is the design; the platform bucket is the safety net, not a move."""
    out = await storage.upload_file(
        file_bytes=b"x", filename="a.png", content_type="image/png",
        user_id="u1", org_id="org1",
    )
    assert out["bucket"] == "org1-bucket"
    assert not out["key"].startswith("org/"), \
        "an org's own bucket needs no namespace and must not gain one"


@pytest.mark.asyncio
async def test_the_org_bucket_key_is_truthy(own_bucket):
    """
    Was: assert the fallback's key is FALSY, so `if result.get("key")` guards in
    pahchan and uploads kept behaving identically.

    That guard existed to catch the keyless fallback. It has nothing left to
    catch, and the expectation inverts: a call that returns at all now returns a
    usable key. This is contract point 3 — a stored presigned URL dies in nine
    hours (ExpiresIn=32400) and without a key nothing can re-sign it, which is
    how five executed e-sign PDFs became permanently unservable. Asserted once
    per backend, because "returns a key" is a property of each of them and not
    of the function in general.
    """
    out = await storage.upload_file(
        file_bytes=b"x", filename="a.pdf", content_type="application/pdf",
        user_id="u1", org_id="org1",
    )
    assert out["key"], "a successful upload with no key cannot ever be re-signed"


@pytest.mark.asyncio
async def test_the_platform_bucket_key_is_truthy(platform_only):
    out = await storage.upload_file(
        file_bytes=b"x", filename="a.pdf", content_type="application/pdf",
        user_id="u1", org_id="org1",
    )
    assert out["key"], "a successful upload with no key cannot ever be re-signed"


@pytest.mark.asyncio
async def test_the_local_disk_key_is_truthy(local_disk):
    out = await storage.upload_file(
        file_bytes=b"x", filename="a.pdf", content_type="application/pdf",
        user_id="u1", org_id="org1",
    )
    assert out["key"], "a successful upload with no key cannot ever be re-signed"


@pytest.mark.asyncio
async def test_the_bytes_survive_the_round_trip(local_disk):
    """
    Was: the same assertion against the base64 fallback, which for two orgs WAS
    the storage. The backend is gone; the guarantee is not. Local disk is the
    one remaining backend a unit test can write to and read back for real, so it
    carries the check.
    """
    payload = b"%PDF-1.4\nthree pages worth of bytes\n%%EOF\n"
    out = await storage.upload_file(
        file_bytes=payload, filename="doc.pdf",
        content_type="application/pdf", user_id="u1", org_id="org1",
    )
    assert not out["url"].startswith("data:")

    back = await storage.download_file(out["key"], "org1", out["url"])
    assert back == payload, "download_file cannot read back what upload_file wrote"


# ── Reading a legacy value is not writing one ────────────────────────────────


@pytest.mark.asyncio
async def test_download_still_reads_a_data_uri_it_is_handed(no_bucket):
    """
    Was: the same test, sourced from `upload_file`'s own output. It cannot be
    sourced that way any more, so the legacy value is written by hand here —
    which is the honest shape of it, because that is where such a value comes
    from now: a caller passing a stored `file_url` out of a row.

    Kept on purpose. The database holds no data URIs after 2026-08-19, but the
    URL is supplied by the caller and can still arrive from a backup, an export
    or a cached payload. Decoding one is harmless; producing one is the thing
    that was stopped.
    """
    legacy = "data:application/octet-stream;base64,Ynl0ZXM="
    assert await storage.download_file("", "org1", legacy) == b"bytes"
    assert await storage.download_file(None, "org1", legacy) == b"bytes"


@pytest.mark.asyncio
async def test_download_returns_none_rather_than_raising_on_nothing(no_bucket):
    """A caller rebuilding a derived artefact should degrade, not 500."""
    assert await storage.download_file("", "org1", None) is None
    assert await storage.download_file("pending", "org1", "pending") is None
