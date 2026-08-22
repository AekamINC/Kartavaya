"""A bucket-scoped R2 token must verify — it was the thing blocking a new org.

`verify_r2_credentials` tested a credential by calling `list_buckets`, and
`list_buckets` is an ACCOUNT-level operation. A Cloudflare API token scoped to
a single bucket — the least-privilege setup Cloudflare's own documentation
recommends — cannot list buckets, though it reads and writes that bucket
perfectly. So the correct credential was rejected, and because the create-org
panel keeps its Create button disabled until verification passes, a correctly
scoped token stopped an organisation being created at all.

The second half of the same bug: the verifier never tested the BUCKET. Callers
hand it an `R2Credentials` carrying `bucket_name` and only three of its four
fields were forwarded, so "verified" never meant "the bucket these files are
going to is reachable" — the only thing the operator wanted to know.

What is pinned here:

  · a bucket-scoped token verifies, with `scope == "bucket"`;
  · an account-scoped token still verifies and still returns its bucket list;
  · a bucket that does not exist yet is NOT a bad credential — it is the normal
    state of a new org, and the 404 is itself proof the signature was accepted;
  · a genuinely wrong secret is still rejected, and says so by error code;
  · the PROBE — proposal 83's third requirement — writes a nine-byte object,
    reads it back, and deletes it again, including when the read-back fails.
    It is the only step that tests the capability rather than the permission,
    and the only one that would catch a bucket which exists, lists, and refuses
    every PUT;
  · both router call sites forward `bucket_name`.
"""
import asyncio
import inspect

import pytest
from botocore.exceptions import ClientError

from services import storage


def _client_error(code: str, status: int, op: str = "HeadBucket") -> ClientError:
    return ClientError(
        {"Error": {"Code": code, "Message": code},
         "ResponseMetadata": {"HTTPStatusCode": status}},
        op,
    )


class _Body:
    def __init__(self, data): self._data = data
    def read(self): return self._data


class FakeR2:
    """The calls the verifier makes, each independently switchable.

    Every attribute is either a return value or an exception instance; anything
    that is an exception is raised. That is what lets one class express an
    account token, a bucket token, a missing bucket, a read-only token and a bad
    secret without a subclass per case.

    `put`/`get`/`delete` default to WORKING, because the healthy path is the
    common one and a test that has to opt in to health tests the wrong thing.
    The probe object is held in `stored`, so a test can assert it was written
    AND that it was cleaned up afterwards.
    """

    def __init__(self, *, buckets=None, head=None, objects=None,
                 put=None, get=None, delete=None):
        self._buckets = buckets
        self._head = head
        self._objects = objects
        self._put = put
        self._get = get
        self._delete = delete
        self.stored: dict[str, bytes] = {}
        self.calls: list[str] = []

    def _answer(self, name, value):
        self.calls.append(name)
        if isinstance(value, Exception):
            raise value
        return value

    def list_buckets(self):
        return self._answer("list_buckets", self._buckets)

    def head_bucket(self, Bucket):            # noqa: N803 — boto3's own casing
        return self._answer("head_bucket", self._head)

    def list_objects_v2(self, Bucket, MaxKeys=None):   # noqa: N803
        return self._answer("list_objects_v2", self._objects)

    def create_bucket(self, Bucket):          # noqa: N803
        return self._answer("create_bucket", None)

    def put_object(self, Bucket, Key, Body, ContentType=None):   # noqa: N803
        self._answer("put_object", self._put)
        self.stored[Key] = Body
        return {}

    def get_object(self, Bucket, Key):        # noqa: N803
        if isinstance(self._get, Exception):
            return self._answer("get_object", self._get)
        self.calls.append("get_object")
        if self._get is not None:
            return {"Body": _Body(self._get)}
        return {"Body": _Body(self.stored[Key])}

    def delete_object(self, Bucket, Key):     # noqa: N803
        self._answer("delete_object", self._delete)
        self.stored.pop(Key, None)
        return {}


@pytest.fixture
def fake_client(monkeypatch):
    holder = {}

    def install(client):
        holder["client"] = client
        monkeypatch.setattr(storage, "_build_client", lambda *a, **k: client)
        return client

    return install


def _verify(**kw):
    return asyncio.run(storage.verify_r2_credentials(
        kw.pop("account", "acct"), kw.pop("key", "AKIA"),
        kw.pop("secret", "s3cret"), kw.pop("bucket", "kartavya-storage"),
    ))


def test_bucket_scoped_token_verifies(fake_client):
    """The exact credential that could not create an org."""
    fake_client(FakeR2(
        buckets=_client_error("AccessDenied", 403, "ListBuckets"),
        head={},
        objects={"KeyCount": 0},
    ))
    result = _verify()

    assert result["valid"] is True
    assert result["scope"] == "bucket"
    assert result["can_list_buckets"] is False
    assert result["bucket_exists"] is True
    assert result["error"] is None


def test_account_scoped_token_still_verifies_and_lists(fake_client):
    fake_client(FakeR2(
        buckets={"Buckets": [{"Name": "kartavya-storage"}, {"Name": "other"}]},
        head={},
        objects={"KeyCount": 0},
    ))
    result = _verify()

    assert result["valid"] is True
    assert result["scope"] == "account"
    assert result["buckets"] == ["kartavya-storage", "other"]


def test_missing_bucket_is_not_a_bad_credential(fake_client):
    """A 404 proves the signature was ACCEPTED. That is a new org, not a fault."""
    fake_client(FakeR2(
        buckets=_client_error("AccessDenied", 403, "ListBuckets"),
        head=_client_error("404", 404),
    ))
    result = _verify()

    assert result["valid"] is True
    assert result["bucket_exists"] is False
    assert result["error"] is None


def test_wrong_secret_is_still_rejected(fake_client):
    fake_client(FakeR2(
        buckets=_client_error("SignatureDoesNotMatch", 403, "ListBuckets"),
        head=_client_error("SignatureDoesNotMatch", 403),
    ))
    result = _verify()

    assert result["valid"] is False
    assert "SignatureDoesNotMatch" in result["error"]


def test_token_with_no_access_to_this_bucket_is_rejected_by_name(fake_client):
    fake_client(FakeR2(
        buckets=_client_error("AccessDenied", 403, "ListBuckets"),
        head=_client_error("AccessDenied", 403),
    ))
    result = _verify(bucket="firm-files")

    assert result["valid"] is False
    assert "firm-files" in result["error"]


def test_write_only_token_verifies_with_a_warning(fake_client):
    """Listing refused, writing fine: uploads work, usage cannot be measured."""
    fake_client(FakeR2(
        buckets=_client_error("AccessDenied", 403, "ListBuckets"),
        head={},
        objects=_client_error("AccessDenied", 403, "ListObjectsV2"),
    ))
    result = _verify()

    assert result["valid"] is True
    assert result["bucket_writable"] is True
    assert result["error"] and "listing" in result["error"]


# ── The probe: the only step that tests the capability being bought ─────────
#
# Proposal 83 asks for it by name. Every other check is a permission question;
# this one puts a file in the bucket, reads it back and removes it.

def test_the_probe_writes_reads_back_and_cleans_up(fake_client):
    client = fake_client(FakeR2(
        buckets=_client_error("AccessDenied", 403, "ListBuckets"),
        head={}, objects={"KeyCount": 0},
    ))
    result = _verify()

    assert result["bucket_writable"] is True
    assert result["probe_round_trip"] is True
    assert result["error"] is None
    assert client.stored == {}, "the probe object was left behind"
    assert [c for c in client.calls if c.startswith(("put", "get", "delete"))] == [
        "put_object", "get_object", "delete_object",
    ]
    key = next(c["detail"] for c in result["checks"] if c["check"] == "put_object")
    assert key.startswith("_probe/")


def test_a_bucket_that_lists_but_refuses_writes_is_reported(fake_client):
    """The failure no permission question could have found."""
    fake_client(FakeR2(
        buckets={"Buckets": [{"Name": "kartavya-storage"}]},
        head={}, objects={"KeyCount": 0},
        put=_client_error("AccessDenied", 403, "PutObject"),
    ))
    result = _verify()

    # Still valid: the credential authenticated. But the sentence says the thing
    # that actually matters, because every upload this org makes will refuse.
    assert result["valid"] is True
    assert result["bucket_writable"] is False
    assert "writing to kartavya-storage was refused" in result["error"]


def test_the_probe_is_deleted_even_when_the_read_back_fails(fake_client):
    client = fake_client(FakeR2(
        buckets=_client_error("AccessDenied", 403, "ListBuckets"),
        head={}, objects={"KeyCount": 0},
        get=_client_error("AccessDenied", 403, "GetObject"),
    ))
    result = _verify()

    assert client.stored == {}, "a failed read-back left litter in the bucket"
    assert result["probe_round_trip"] is False
    assert "did not read back" in result["error"]


def test_a_missing_bucket_is_never_probed(fake_client):
    """Nothing is written to a bucket that does not exist."""
    client = fake_client(FakeR2(
        buckets=_client_error("AccessDenied", 403, "ListBuckets"),
        head=_client_error("404", 404),
    ))
    _verify()
    assert "put_object" not in client.calls


def test_no_bucket_name_falls_back_to_the_account_check(fake_client):
    """Callers outside the router may pass three fields. That must still work."""
    fake_client(FakeR2(buckets={"Buckets": []}))
    result = asyncio.run(storage.verify_r2_credentials("acct", "AKIA", "s3cret"))

    assert result["valid"] is True
    assert result["scope"] == "account"


def test_create_org_bucket_does_not_create_one_that_exists(fake_client, monkeypatch):
    """A bucket-scoped token cannot call create_bucket and must not need to."""
    client = fake_client(FakeR2(head={}))

    async def _org_r2(org_id):
        return client, "kartavya-storage"

    monkeypatch.setattr(storage, "_get_org_r2", _org_r2)
    assert asyncio.run(storage.create_org_bucket("org")) == "kartavya-storage"
    assert "create_bucket" not in client.calls


def test_both_router_call_sites_forward_the_bucket_name():
    """`bucket_name` is the fourth field, and it was the one being dropped."""
    from routers import admin_orgs

    src = inspect.getsource(admin_orgs)
    calls = src.count("await verify_r2_credentials(")
    assert calls == 3, f"expected verify at create, verify and set; found {calls}"
    for block in src.split("await verify_r2_credentials(")[1:]:
        head = block.split(")")[0]
        assert "bucket_name" in head, f"a call site drops bucket_name: {head!r}"
