"""The signature is a file, and a file does not live in a column.

`POST /api/v1/esign/verify/{token}/sign` takes `signature_data` from a caller
whose entire authority is a token that has travelled through mail relays, and
wrote it into `staging.sign_signers` exactly as it arrived — which for a drawn
signature is a canvas PNG data URI. Image bytes in a TEXT column, on a public
endpoint, with no size limit of any kind. That is the shape that accumulated
99MB inside the database before those rows were repointed at R2 on 2026-08-19,
and the owner's rule is that a column holds a KEY.

Five properties are asserted here:

  1. A drawn signature becomes an R2 object and the column receives `r2:<key>`.
     The base64 never reaches the UPDATE.
  2. A TYPED signature is a person's name and not a file, so it is stored as it
     was sent and nothing is uploaded for it at all.
  3. Any other `data:` value is refused with a 422 naming the field. This is
     independent of (1): R2 can be perfectly healthy and a caller can still post
     a PDF into a TEXT column through a JSON string field.
  4. The size is BOUNDED at what the signature page can draw — and bounded in
     the right units. The field caps base64 CHARACTERS, so one POST cannot be
     megabytes; the 512 KB ceiling is checked on the DECODED image, which is
     the length the page measures. Spending one number on both refused the
     ordinary 400 KB scanned signature that the page reproduces.
  5. The executed PDF still renders. `esign_signed_doc.signature_mark` embeds a
     bounded inline image or escapes text, and it must keep being handed exactly
     that — for the new shape, for a typed name, and for the one legacy inline
     row (7.9 kB) that was deliberately left as it was.
"""
import base64
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

import routers.esign as esign
from services.esign_signed_doc import signature_mark


DOC_ID = uuid.UUID("00000000-0000-0000-0000-0000000000dd")
SIGNER_ID = uuid.UUID("00000000-0000-0000-0000-0000000000aa")
ORG_ID = "00000000-0000-0000-0000-000000000001"
OPEN = datetime.now(timezone.utc) + timedelta(days=5)

# A real PNG header, so an assertion about "the bytes that were uploaded" is
# about something recognisable rather than about a blob of zeroes.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"signature-ink" * 8
DRAWN = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode()

#: What `upload_file` hands back, in the grammar of proposal 83 §4. The value
#: itself is only ever echoed into the column, so its shape matters here as
#: documentation rather than as behaviour — but a stale one would describe a
#: layout the product no longer writes.
STORED_KEY = (
    "esign/00000000-0000-0000-0000-0000000000dd/signature/"
    "00000000-0000-0000-0000-0000000000aa/2026/08/01M0PD8DD09QVSEPMHQ7M6RN91"
    "--signature.png"
)


class _Req:
    class _C:
        host = "203.0.113.9"
    client = _C()
    headers = {"user-agent": "pytest", "content-type": "application/json"}


def _signer(**over):
    row = {
        "id": SIGNER_ID, "document_id": DOC_ID, "doc_id": DOC_ID,
        "name": "Asha Rao", "email": "asha@example.invalid",
        "status": "opened", "otp_verified": True,
        "signed_at": None, "signers_total": 2, "signers_completed": 0,
        "org_id": ORG_ID,
        "file_key": "k", "file_url": "u", "file_hash": "h",
        "doc_status": "sent", "expires_at": OPEN,
    }
    row.update(over)
    return row


def _pool_for(row):
    """The fake from test_esign_public_signing_gates, plus the written value.

    The signer flip is `UPDATE … signature_data=$1 … RETURNING id`, so the first
    bind parameter of that statement is the thing this file is about.
    """
    class _P:
        executed = []
        signature_written = None

        async def fetchrow(self, q, *a, **_k):
            if q.lstrip().upper().startswith("UPDATE"):
                self.executed.append(q)
            if "signature_data=$1" in q:
                self.signature_written = a[0]
            if "SET" in q and "signers_completed = signers_completed + 1" in q:
                bumped = dict(row)
                bumped["signers_completed"] = (row.get("signers_completed") or 0) + 1
                total = row.get("signers_total") or 0
                bumped["status"] = ("completed"
                                    if bumped["signers_completed"] >= total
                                    else "partially_signed")
                return bumped
            return row

        async def fetchval(self, *_a, **_k):
            return 1

        async def execute(self, q, *_a, **_k):
            self.executed.append(q)
            return None

        async def fetch(self, *_a, **_k):
            return []

        def acquire(self):
            pool = self

            class _A:
                async def __aenter__(_s):
                    return pool

                async def __aexit__(_s, *exc):
                    return False
            return _A()

        def transaction(self):
            class _T:
                async def __aenter__(_s):
                    return _s

                async def __aexit__(_s, *exc):
                    return False
            return _T()

    return _P()


@pytest.fixture
def no_pool(monkeypatch):
    def _install(row):
        pool = _pool_for(row)

        async def _get_pool():
            return pool

        monkeypatch.setattr(esign, "get_pool", _get_pool)
        return pool

    return _install


@pytest.fixture
def stored(monkeypatch):
    """`upload_file`, recording what it was asked to store."""
    seen = {}

    async def _upload(**kw):
        seen.update(kw)
        return {
            "url": "https://acc.r2.cloudflarestorage.com/bucket/" + STORED_KEY,
            "name": kw["filename"], "key": STORED_KEY,
            "size": len(kw["file_bytes"]), "bucket": "bucket",
        }

    monkeypatch.setattr(esign, "upload_file", _upload)
    return seen


# ── 1 · the bytes go to R2 and the column holds the pointer ───────────────────

@pytest.mark.asyncio
async def test_a_drawn_signature_is_stored_as_an_object_and_the_column_holds_the_key(
        no_pool, stored):
    pool = no_pool(_signer())

    out = await esign.submit_signature(
        "tok", esign.SignatureSubmit(signature_data=DRAWN, signature_type="draw"), _Req(),
    )

    assert out["signed"] is True
    # The image was handed to storage, decoded, not as a string.
    assert stored["file_bytes"] == PNG_BYTES
    assert stored["content_type"] == "image/png"
    assert stored["org_id"] == ORG_ID

    # ── THE KEY NAMES ITS AGREEMENT NOW ─────────────────────────────────────
    #
    # This asserted `folder == "esign/signatures"`, which put every signature
    # ever captured — for every document, for every org — in one flat prefix.
    # Proposal 83 §3: "to answer 'show me the files for this agreement' you must
    # query the database; the bucket cannot answer it", and deleting an
    # agreement could not delete its files because its files were not gathered
    # anywhere.
    #
    # The grammar (§4) is module / what it belongs to / who did it / date:
    # `esign/{document_id}/signature/{signer_id}/YYYY/MM/{id}--signature.png`.
    # `folder` is not passed at all any more, so its absence is part of the
    # assertion.
    assert "folder" not in stored, "the caller-invented prefix is back"
    assert stored["module"] == "esign"
    assert stored["scope"] == [str(DOC_ID), "signature"]
    # The signer, not a product user: an external party acting through a token
    # is still the "who did it" segment the grammar asks for.
    assert stored["user_id"] == str(SIGNER_ID)
    # And the row got a pointer.
    assert pool.signature_written == f"r2:{STORED_KEY}"
    assert "base64" not in pool.signature_written


@pytest.mark.asyncio
async def test_the_document_is_not_signed_when_the_signature_cannot_be_stored(
        no_pool, monkeypatch):
    """Failing an upload is correct; putting the file in the column is not.

    `pahchan.py` refuses a punch photo on the same condition, for the same
    reason: an object nothing can NAME cannot be re-signed once its nine-hour
    URL lapses, which is exactly how five executed e-sign PDFs became
    permanently unservable.
    """
    pool = no_pool(_signer())

    async def _upload(**_kw):
        return {"url": "", "name": "signature.png", "key": "", "size": 0, "bucket": None}

    monkeypatch.setattr(esign, "upload_file", _upload)

    with pytest.raises(esign.HTTPException) as e:
        await esign.submit_signature(
            "tok", esign.SignatureSubmit(signature_data=DRAWN, signature_type="draw"), _Req(),
        )

    assert e.value.status_code == 503
    assert pool.signature_written is None
    assert not any("status='signed'" in q for q in pool.executed)


# ── 2 · a typed name is not a file ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_typed_signature_is_stored_as_typed_and_uploads_nothing(
        no_pool, monkeypatch):
    pool = no_pool(_signer())

    async def _upload(**_kw):
        raise AssertionError("a person's name is not a file and must not be uploaded")

    monkeypatch.setattr(esign, "upload_file", _upload)

    out = await esign.submit_signature(
        "tok", esign.SignatureSubmit(signature_data="Asha Rao", signature_type="type"), _Req(),
    )

    assert out["signed"] is True
    assert pool.signature_written == "Asha Rao"


# ── 3 · every other data: value is refused, by name ───────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "value",
    [
        "data:application/pdf;base64,JVBERi0xLjQK",
        "data:text/html;base64,PHNjcmlwdD4=",
        "data:image/png;base64,not valid base64 ****",
    ],
    ids=["pdf", "html", "unreadable"],
)
async def test_a_data_uri_that_is_not_a_signature_image_is_refused(no_pool, value):
    pool = no_pool(_signer())

    with pytest.raises(esign.HTTPException) as e:
        await esign.submit_signature(
            "tok", esign.SignatureSubmit(signature_data=value, signature_type="upload"), _Req(),
        )

    assert e.value.status_code == 422
    assert "signature_data" in e.value.detail
    assert pool.signature_written is None
    assert not any("status='signed'" in q for q in pool.executed)


# ── 4 · the field is bounded ──────────────────────────────────────────────────

def test_the_field_is_bounded_so_one_post_cannot_be_megabytes():
    """There was no bound at all, on an endpoint that needs no session — one
    POST could put an arbitrary number of megabytes into `staging.sign_signers`.
    """
    esign.SignatureSubmit(signature_data="d" * esign._MAX_SIGNATURE_B64_CHARS)
    with pytest.raises(ValidationError) as e:
        esign.SignatureSubmit(signature_data="d" * (esign._MAX_SIGNATURE_B64_CHARS + 1))
    assert "signature_data" in str(e.value)


def test_the_field_bound_is_counted_in_the_units_the_field_carries():
    """Base64 is ASCII, but it is not 1:1 — four characters per three bytes.

    Bounding the STRING at `MAX_SIGNATURE_BYTES` refused every image over
    384 KB, so the field answered 422 for signatures the executed page draws
    without complaint.
    """
    assert esign._MAX_SIGNATURE_B64_CHARS > esign._MAX_SIGNATURE_BYTES
    # Loose enough to admit the largest drawable image plus its `data:` prefix…
    largest = "data:image/jpeg;base64," + base64.b64encode(
        b"\xff\xd8\xff" + b"j" * (esign._MAX_SIGNATURE_BYTES - 3)).decode()
    assert len(largest) <= esign._MAX_SIGNATURE_B64_CHARS
    # …and tight enough that what it admits cannot decode past the ceiling by
    # more than the prefix allowance.
    admitted = (esign._MAX_SIGNATURE_B64_CHARS // 4) * 3
    assert admitted - esign._MAX_SIGNATURE_BYTES < 1024


@pytest.mark.asyncio
async def test_an_image_the_page_can_draw_is_accepted_not_refused_by_the_field(
        no_pool, stored):
    """400 KB is an ordinary scanned signature and `signature_mark` reproduces
    it. Encoded it is ~547 K characters, which a 512 K character bound refused —
    a submission that worked before the field was bounded at all.
    """
    pool = no_pool(_signer())
    image = b"\x89PNG\r\n\x1a\n" + b"ink" * ((400 * 1024 - 8) // 3)
    assert '<img class="esd-sig__img"' in signature_mark(
        "data:image/png;base64," + base64.b64encode(image).decode(), "upload")

    out = await esign.submit_signature(
        "tok",
        esign.SignatureSubmit(
            signature_data="data:image/png;base64," + base64.b64encode(image).decode(),
            signature_type="upload",
        ),
        _Req(),
    )

    assert out["signed"] is True
    assert stored["file_bytes"] == image
    assert pool.signature_written == f"r2:{STORED_KEY}"


@pytest.mark.asyncio
async def test_an_image_past_the_ceiling_is_refused_on_its_decoded_length(
        no_pool, monkeypatch):
    """The page prints a note instead of a signature past `MAX_SIGNATURE_BYTES`,
    so storing one is storing bytes no executed document will ever reproduce.
    The check is on the DECODED image, which is what the page measures.
    """
    pool = no_pool(_signer())

    async def _upload(**_kw):
        raise AssertionError("a signature that cannot be drawn must not be stored")

    monkeypatch.setattr(esign, "upload_file", _upload)

    oversize = b"\x89PNG\r\n\x1a\n" + b"z" * (esign._MAX_SIGNATURE_BYTES + 1 - 8)
    body = esign.SignatureSubmit(
        signature_data="data:image/png;base64," + base64.b64encode(oversize).decode(),
        signature_type="upload",
    )

    with pytest.raises(esign.HTTPException) as e:
        await esign.submit_signature("tok", body, _Req())

    assert e.value.status_code == 422
    assert "signature_data" in e.value.detail
    assert pool.signature_written is None
    assert not any("status='signed'" in q for q in pool.executed)


# ── 5 · the executed PDF still renders every shape ────────────────────────────

@pytest.mark.asyncio
async def test_a_stored_signature_comes_back_inline_for_the_render(monkeypatch):
    import services.storage as storage

    async def _download(key, org_id=None, url=None):
        assert key == STORED_KEY
        return PNG_BYTES

    monkeypatch.setattr(storage, "download_file", _download)

    inline = await esign._signature_for_render(f"r2:{STORED_KEY}", ORG_ID)

    assert base64.b64decode(inline.split(",", 1)[1]) == PNG_BYTES
    # …and the renderer draws it, unchanged from what it did before the key.
    assert '<img class="esd-sig__img"' in signature_mark(inline, "draw")


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy", [DRAWN, "Asha Rao"], ids=["inline-png", "typed"])
async def test_a_row_that_is_not_a_key_is_handed_over_untouched(legacy):
    """One legacy inline row (7.9 kB) was deliberately left alone, and every
    typed signature is text. Neither goes near storage."""
    assert await esign._signature_for_render(legacy, ORG_ID) == legacy


@pytest.mark.asyncio
async def test_an_unreadable_object_leaves_a_blank_rule_never_the_key(monkeypatch):
    """A storage key printed on a signature page is storage internals in a
    document a court reads. The page already draws a blank rule for a signature
    it cannot reproduce, and `POST /documents/{id}/rebuild` is the second try.
    """
    import services.storage as storage

    async def _download(key, org_id=None, url=None):
        return None

    monkeypatch.setattr(storage, "download_file", _download)

    out = await esign._signature_for_render(f"r2:{STORED_KEY}", ORG_ID)

    assert out == ""
    assert STORED_KEY not in signature_mark(out, "draw")
