"""What was written to the platform bucket has to be readable from it.

`upload_file` gained a second choice on 2026-08-05: an org with no Cloudflare
account of its own writes to the vendor's bucket under `org/<org_id>/`, or
`shared/` when the call carries no org at all. `sign_key` was taught to read
that prefix and pick the bucket from the KEY rather than from whatever
credentials the org has today. The other three readers were not, and asked
`_get_org_r2` alone — so for the two orgs without their own credentials, Aekam
Inc among them, every object the platform bucket held was write-only. Uploads
succeeded, `sign_key` handed out working URLs, and `download_file` said the
file could not be read.

The cost was not hypothetical and it was not cosmetic:

  * `esign._generate_signed_pdf` reads the contract back to append its pages and
    each signature back to draw it. Both returned None, so the executed PDF was
    a single signature page with a blank rule where every signature belonged —
    the same permanently-unservable artefact the base64 fallback had already
    produced five of.
  * `esign_service.send_for_signature` answered "re-upload the file and try
    again" for a file that was already stored, and the re-upload went to the
    same unreadable place, so the loop could not clear.
  * `delete_file` was worse than useless for an org that DID have its own
    bucket: the platform key was deleted against the org's bucket, S3 answers
    204 for an object that was never there, so the Pahchan retention sweeper
    marked the row purged and left the photo in the platform bucket for good.

The existing round-trip assertion (`test_storage_no_r2_fallback.py::
test_the_bytes_survive_the_round_trip`) runs on the local-disk backend, which
has no bucket to get wrong, so none of this failed a test. These do.
"""
import pytest

from services import storage


class _Bucketed:
    """One R2 account. Objects are keyed by (bucket, key), because that pair is
    exactly what the bug got wrong — the key was right and the bucket was not."""

    def __init__(self, name):
        self.name = name
        self.objects: dict[tuple[str, str], bytes] = {}
        self.deleted: list[tuple[str, str]] = []
        self.signed: list[tuple[str, str]] = []

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[(Bucket, Key)] = Body

    def get_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise Exception("NoSuchKey")

        class _Body:
            def __init__(self, data):
                self._data = data

            def read(self):
                return self._data

        return {"Body": _Body(self.objects[(Bucket, Key)])}

    def delete_object(self, Bucket, Key):
        self.deleted.append((Bucket, Key))

    def generate_presigned_url(self, op, Params, ExpiresIn):
        self.signed.append((Params["Bucket"], Params["Key"]))
        return (f"https://acct.r2.cloudflarestorage.com/"
                f"{Params['Bucket']}/{Params['Key']}?X-Amz-Signature=deadbeef")


@pytest.fixture
def platform(monkeypatch):
    """The vendor's bucket, configured. The org's own credentials are set per test."""
    monkeypatch.setattr(storage, "LOCAL_STORAGE_PATH", None)
    client = _Bucketed("platform")
    storage._platform_cache.clear()
    storage._platform_cache.append((client, "kartavaya-platform"))
    yield client
    storage._platform_cache.clear()


@pytest.fixture
def no_org_r2(monkeypatch):
    """The org has no Cloudflare account. Two of the three orgs are in this state."""
    async def _none(org_id):
        return None, None

    monkeypatch.setattr(storage, "_get_org_r2", _none)


@pytest.fixture
def own_r2(monkeypatch):
    """The org brought its own account — including AFTER files already existed."""
    own = _Bucketed("own")

    async def _own(org_id):
        return own, "org1-bucket"

    monkeypatch.setattr(storage, "_get_org_r2", _own)
    return own


# ── Reading back what was just written ───────────────────────────────────────


@pytest.mark.asyncio
async def test_the_platform_bucket_round_trips(platform, no_org_r2):
    """THE regression, in the smallest form that shows it: upload then download.

    An org with no credentials of its own uploads a contract; `upload_file` puts
    it in the platform bucket. `download_file` has to find it there. It asked
    the org — which has nothing — and answered None.
    """
    payload = b"%PDF-1.4\nthe pages of the contract\n%%EOF\n"
    out = await storage.upload_file(
        file_bytes=payload, filename="contract.pdf",
        content_type="application/pdf", user_id="u1",
        folder="esign/originals", org_id="org1",
    )
    assert out["bucket"] == "kartavaya-platform"

    back = await storage.download_file(out["key"], "org1", out["url"])
    assert back == payload, (
        "the object upload_file just wrote to the platform bucket could not be "
        "read back — this is the executed e-sign PDF losing the contract's pages"
    )


@pytest.mark.asyncio
async def test_a_signature_object_survives_the_org_bringing_its_own_bucket(platform, monkeypatch):
    """The hazard `sign_key`'s prefix exists for, applied to the reader.

    Signatures are stored as `r2:<key>` in `sign_signers.signature_data` and read
    back at completion by `esign._signature_for_render`. If the org fills in its
    Cloudflare details between the signing and the render, resolving by the ORG
    looks in a brand-new empty bucket. `_signature_for_render` turns that miss
    into "" and the page prints a blank rule under the signatory's name.
    """
    async def _none(org_id):
        return None, None

    monkeypatch.setattr(storage, "_get_org_r2", _none)
    out = await storage.upload_file(
        file_bytes=b"\x89PNG\r\n\x1a\n signature", filename="sig.png",
        content_type="image/png", user_id="u1",
        folder="esign/signatures", org_id="org1",
    )

    own = _Bucketed("own")

    async def _own(org_id):
        return own, "org1-bucket"

    monkeypatch.setattr(storage, "_get_org_r2", _own)

    assert await storage.download_file(out["key"], "org1") == b"\x89PNG\r\n\x1a\n signature", \
        "an existing signature stopped being readable the moment the org added credentials"


@pytest.mark.asyncio
async def test_an_upload_with_no_org_at_all_is_readable(platform, no_org_r2):
    """`server.py`'s task-attachment route calls `upload_file` with NO org_id, so
    its keys are `shared/…`. Resolving by org cannot work for them at all —
    there is no org to resolve."""
    out = await storage.upload_file(
        file_bytes=b"attachment bytes", filename="a.pdf",
        content_type="application/pdf", user_id="u1",
    )
    assert out["key"].startswith("shared/")
    assert await storage.download_file(out["key"], "org1") == b"attachment bytes"


# ── The org's own bucket is untouched ────────────────────────────────────────
#
# Per-org R2 is the design and it works today. Every test above must be true
# without changing one thing about the primary path.


@pytest.mark.asyncio
async def test_the_org_bucket_still_serves_its_own_unprefixed_keys(platform, own_r2):
    payload = b"%PDF-1.4 the org's own bucket\n"
    out = await storage.upload_file(
        file_bytes=payload, filename="c.pdf", content_type="application/pdf",
        user_id="u1", folder="esign/originals", org_id="org1",
    )
    assert out["bucket"] == "org1-bucket"
    assert not out["key"].startswith("org/")
    assert await storage.download_file(out["key"], "org1", out["url"]) == payload
    assert not platform.objects, "the platform bucket took an upload that had an org bucket to go to"


@pytest.mark.asyncio
async def test_an_unreadable_key_still_degrades_instead_of_raising(platform, no_org_r2):
    """A caller rebuilding a derived artefact should get None and carry on."""
    assert await storage.download_file("org/org1/esign/originals/missing.pdf", "org1") is None


@pytest.mark.asyncio
async def test_a_legacy_data_uri_is_still_decoded(platform, own_r2):
    """Unchanged and deliberate: reading a value somebody already stored is
    harmless, and dropping it would turn a row restored from a backup into a
    silently blank artefact."""
    legacy = "data:application/octet-stream;base64,Ynl0ZXM="
    assert await storage.download_file("", "org1", legacy) == b"bytes"


# ── Deleting from the bucket that actually holds it ──────────────────────────


@pytest.mark.asyncio
async def test_a_platform_key_is_deleted_from_the_platform_bucket(platform, own_r2):
    """The retention sweeper's failure mode was silent SUCCESS: S3 answers 204
    for an object that was never in the bucket you asked, so `delete_file`
    returned True, the row was marked purged, and the photo stayed."""
    assert await storage.delete_file("org/org1/pahchan/punch/x.jpg", org_id="org1") is True
    assert platform.deleted == [("kartavaya-platform", "org/org1/pahchan/punch/x.jpg")]
    assert own_r2.deleted == [], "the delete was aimed at a bucket that never held the object"


@pytest.mark.asyncio
async def test_an_org_key_is_still_deleted_from_the_org_bucket(platform, own_r2):
    assert await storage.delete_file("pahchan/org1/punch/y.jpg", org_id="org1") is True
    assert own_r2.deleted == [("org1-bucket", "pahchan/org1/punch/y.jpg")]
    assert platform.deleted == []


# ── Re-signing an old URL that has no key beside it ──────────────────────────
#
# `refresh_signed_url` is deprecated in favour of a stored key, but it is still
# the fallback `hub.sign_content_images` uses for the six Srijan images that
# predate `image_key`, so it has to reach the platform bucket too.


@pytest.mark.asyncio
async def test_refresh_reaches_a_platform_object_for_an_org_with_its_own_bucket(platform, own_r2):
    """The path carries the PLATFORM bucket's name, so stripping the ORG's name
    never matched and the whole `<bucket>/<key>` was signed as the key —
    producing a fresh, valid-looking URL that 404s."""
    stored = ("https://acct.r2.cloudflarestorage.com/"
              "kartavaya-platform/org/org1/srijan/images/abc.png?X-Amz-Signature=expired")

    fresh = await storage.refresh_signed_url("org1", stored)

    assert platform.signed == [("kartavaya-platform", "org/org1/srijan/images/abc.png")], \
        "the bucket name was left glued to the front of the key"
    assert "kartavaya-platform/kartavaya-platform" not in fresh
    assert own_r2.signed == []


@pytest.mark.asyncio
async def test_refresh_reaches_a_platform_object_for_an_org_with_no_bucket(platform, no_org_r2):
    """With no org credentials this returned the EXPIRED url unchanged, which is
    the one outcome indistinguishable from doing nothing."""
    stored = ("https://acct.r2.cloudflarestorage.com/"
              "kartavaya-platform/org/org1/srijan/images/abc.png?X-Amz-Signature=expired")

    fresh = await storage.refresh_signed_url("org1", stored)

    assert fresh != stored, "the expired URL was handed straight back"
    assert platform.signed == [("kartavaya-platform", "org/org1/srijan/images/abc.png")]


@pytest.mark.asyncio
async def test_refresh_still_strips_the_org_bucket_from_an_org_url(platform, own_r2):
    """The behaviour that already worked, pinned so the two-candidate strip
    cannot regress it."""
    stored = ("https://acct.r2.cloudflarestorage.com/"
              "org1-bucket/srijan/images/def.png?X-Amz-Signature=expired")

    await storage.refresh_signed_url("org1", stored)

    assert own_r2.signed == [("org1-bucket", "srijan/images/def.png")]
    assert platform.signed == []


@pytest.mark.asyncio
async def test_refresh_leaves_a_data_uri_alone(platform, own_r2):
    legacy = "data:image/png;base64,Ynl0ZXM="
    assert await storage.refresh_signed_url("org1", legacy) == legacy
    assert own_r2.signed == [] and platform.signed == []


# ── One rule, one place ──────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("key,expected", [
    ("org/org1/esign/originals/a.pdf", "kartavaya-platform"),
    ("shared/personal/u1/b.pdf", "kartavaya-platform"),
    ("esign/originals/c.pdf", "org1-bucket"),
    ("personal/u1/d.pdf", "org1-bucket"),
])
async def test_every_reader_agrees_on_where_a_key_lives(platform, own_r2, key, expected):
    """THE RATCHET. `sign_key` knew the rule and the other three did not, and
    that divergence is the whole defect — not any one of them being wrong on its
    own. A fifth reader added later that resolves the bucket for itself is the
    only way past this.
    """
    platform.objects[("kartavaya-platform", key)] = b"payload"
    own_r2.objects[("org1-bucket", key)] = b"payload"

    signed = await storage.sign_key("org1", key)
    assert f"/{expected}/{key}" in signed

    await storage.download_file(key, "org1")
    await storage.delete_file(key, org_id="org1")

    holder = platform if expected == "kartavaya-platform" else own_r2
    other = own_r2 if expected == "kartavaya-platform" else platform
    assert holder.deleted == [(expected, key)]
    assert other.deleted == [], "a reader sent this key to the wrong bucket"
