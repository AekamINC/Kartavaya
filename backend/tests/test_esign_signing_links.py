"""Signature requests: each signer gets their OWN link, and nothing lies.

This file exists because four independent faults sat in one `try` block in
`services/esign_service.send_for_signature`, a single `except Exception`
swallowed all four, and the endpoint answered `{"status": "sent"}` while not one
email had ever left the process:

  1. `from services.email_service import send_email` — no such module;
     `email_service` is at the backend root.
  2. `await send_email(...)` — it is synchronous and returns bool.
  3. `to=` / `html=` — the parameters are `to_email` / `html_content`.
  4. `created[...].get('_token', token)` — `_token` was never a key on those
     dicts, so it fell through to the loop variable, which after the loop holds
     the LAST signer's token.

Fault 4 is the dangerous one and the reason the first three could not simply be
fixed: repairing the import alone would have turned a feature that sent nothing
into one that sent every party a link authorising them to sign as every other
party. So the property under test is not "an email was sent" — it is **each
signer received their own token, and no token reached the response body**.

── What this file could not see, and what now watches it ────────────────────

Every assertion here passed while the feature was still completely broken in a
different way: the token each signer received was written to
`staging.ganit_contract_signers`, and the page behind the emailed link reads
`staging.sign_signers`. Each signer did get their own dead link. A behavioural
test over a mocked pool cannot notice that, because the mock resolves any table
name it is handed — so that half is pinned at the source level by
`test_signing_link_resolves.py`, and this file stays what it was: what the send
DOES.

The tests below now also cover the two refusals, because the send path acquired
a precondition it did not have: a contract with no document attached cannot be
sent for signature at all.
"""
import pytest

import services.esign_service as esign


class _Row(dict):
    """asyncpg rows are mapping-like; the code reads them by key."""


CONTRACT = {
    "id": "c0000000-0000-0000-0000-000000000001",
    "org_id": "00000000-0000-0000-0000-0000000000aa",
    "title": "Master Services Agreement",
    "description": "FY26 engagement",
    "file_key": "esign/originals/msa.pdf",
    "file_url": "https://r2.example/msa.pdf",
}


def _pool_returning(tokens):
    """A pool whose signer INSERT hands back a different token per call, in order.

    The first `fetchrow` is the document INSERT and gets its own id; the signer
    inserts follow. The row ids deliberately do NOT embed the token: the leak
    test greps the returned structure for token strings, and an id like
    `id-tok-aaa` would make it fail on the fixture rather than on the code.
    """
    calls = iter(enumerate(tokens))

    class _P:
        def __init__(self):
            self.queries = []
            self.first = True

        async def fetchrow(self, q, *a, **k):
            self.queries.append(q)
            # Dispatch on the QUERY, not on call order. This fixture used to
            # answer the first fetchrow with the document row and everything
            # after it with a signer — so adding any SELECT ahead of the INSERT
            # silently shifted every subsequent answer by one. The "already
            # sent" guard is exactly such a SELECT, and it turned eight passing
            # tests red without any of them being about the guard.
            if "status IN ('sent'" in q:
                return None            # no live request: these test a FIRST send
            if self.first:
                self.first = False
                return _Row(id="d0000000-0000-0000-0000-000000000009")
            i, tok = next(calls)
            return _Row(id=f"00000000-0000-0000-0000-{i:012d}", token=tok)

        async def execute(self, q, *a, **k):
            self.queries.append(q)
            return None

        async def fetch(self, q, *a, **k):
            self.queries.append(q)
            return []

    return _P()


@pytest.fixture
def sent(monkeypatch):
    """Capture every send_email call. Nothing leaves the process."""
    captured = []

    # `**kw` because `send_email`'s signature grew: it takes a keyword-only
    # `purpose` (and `ref`), which names the outbound_log row AND chooses the
    # From address. A stub narrower than the real function turns a correct
    # caller into a TypeError the caller then reports as a failed send —
    # which is what these five tests started asserting.
    def _fake(to_email, subject, html_content, reply_to=None, **kw):
        captured.append({"to": to_email, "subject": subject, "html": html_content})
        return True

    monkeypatch.setattr(esign, "send_email", _fake)
    monkeypatch.setenv("FRONTEND_URL", "https://kartavaya.com")
    return captured


@pytest.fixture(autouse=True)
def _readable_document(monkeypatch):
    """The contract's file, present and readable.

    Patched on `services.storage` rather than on `esign`, because the import is
    inside the function — the name never exists on this module. The bytes are
    arbitrary; only their SHA-256 reaches the row, and `test_the_stored_hash_is
    _of_the_actual_bytes` is the one test that cares which bytes they were.
    """
    import services.storage as storage

    async def _dl(key, org_id=None, url=None):
        return b"%PDF-1.7 pretend contract"

    monkeypatch.setattr(storage, "download_file", _dl)


SIGNERS = [
    {"name": "Asha Rao", "email": "asha@example.invalid"},
    {"name": "Vikram Nair", "email": "vikram@example.invalid"},
    {"name": "Priya Shah", "email": "priya@example.invalid"},
]


@pytest.mark.asyncio
async def test_every_signer_gets_their_own_link(sent):
    """The bug: all three would have received signer 3's token."""
    pool = _pool_returning(["tok-aaa", "tok-bbb", "tok-ccc"])

    created, failed = await esign.send_for_signature(pool, CONTRACT, SIGNERS, "user-1")

    assert failed == []
    assert len(sent) == 3

    by_email = {m["to"]: m["html"] for m in sent}
    assert "tok-aaa" in by_email["asha@example.invalid"]
    assert "tok-bbb" in by_email["vikram@example.invalid"]
    assert "tok-ccc" in by_email["priya@example.invalid"]

    # And — the actual failure mode — no signer may hold anyone else's token.
    assert "tok-ccc" not in by_email["asha@example.invalid"]
    assert "tok-aaa" not in by_email["priya@example.invalid"]


@pytest.mark.asyncio
async def test_the_link_in_the_email_is_the_signing_route(sent):
    """Not just "the token appears somewhere in the body" — the whole URL.

    A token printed in the prose of an email nobody can act on is what the
    previous version of this assertion would have accepted.
    """
    pool = _pool_returning(["tok-aaa"])

    await esign.send_for_signature(pool, CONTRACT, SIGNERS[:1], "user-1")

    assert "https://kartavaya.com/sign/tok-aaa" in sent[0]["html"]


@pytest.mark.asyncio
async def test_no_token_reaches_the_response_body(sent):
    """`routers/ganit.py` returns this list verbatim as JSON.

    A token in it hands the authority to sign to whoever posted the request.
    """
    pool = _pool_returning(["tok-aaa", "tok-bbb", "tok-ccc"])

    created, _ = await esign.send_for_signature(pool, CONTRACT, SIGNERS, "user-1")

    blob = repr(created)
    for tok in ("tok-aaa", "tok-bbb", "tok-ccc"):
        assert tok not in blob, f"{tok} leaked into the response body"
    assert all(set(c) == {"id", "name", "email"} for c in created)


@pytest.mark.asyncio
async def test_a_failed_send_is_reported_not_swallowed(monkeypatch):
    """The original answered "sent" with zero emails sent. It must not again."""
    monkeypatch.setenv("FRONTEND_URL", "https://kartavaya.com")

    def _refuse(to_email, subject, html_content, reply_to=None, **kw):
        return to_email != "vikram@example.invalid"

    monkeypatch.setattr(esign, "send_email", _refuse)
    pool = _pool_returning(["t1", "t2", "t3"])

    created, failed = await esign.send_for_signature(pool, CONTRACT, SIGNERS, "user-1")

    assert failed == ["vikram@example.invalid"]
    assert len(created) == 3, "signer rows are valid even when the mail is not"


@pytest.mark.asyncio
async def test_a_raising_send_does_not_abort_the_others(monkeypatch):
    """One bad address must not cost the other signers their email."""
    monkeypatch.setenv("FRONTEND_URL", "https://kartavaya.com")
    seen = []

    def _boom(to_email, subject, html_content, reply_to=None, **kw):
        if to_email == "asha@example.invalid":
            raise RuntimeError("provider rejected the address")
        seen.append(to_email)
        return True

    monkeypatch.setattr(esign, "send_email", _boom)
    pool = _pool_returning(["t1", "t2", "t3"])

    created, failed = await esign.send_for_signature(pool, CONTRACT, SIGNERS, "user-1")

    assert failed == ["asha@example.invalid"]
    assert seen == ["vikram@example.invalid", "priya@example.invalid"]


@pytest.mark.asyncio
async def test_the_signer_name_is_escaped(sent):
    """A name is user-supplied and lands in HTML."""
    pool = _pool_returning(["t1"])

    await esign.send_for_signature(
        pool, CONTRACT,
        [{"name": "<script>alert(1)</script>", "email": "x@example.invalid"}],
        "user-1",
    )

    assert "<script>" not in sent[0]["html"]
    assert "&lt;script&gt;" in sent[0]["html"]


@pytest.mark.asyncio
async def test_a_contract_with_no_document_is_refused(sent):
    """The refusal is the feature.

    All 63 contracts in the database have an empty `file_key` and no endpoint
    uploads one. Sending anyway would email a stranger a link to put a legally
    binding signature on a title and a description, and would record the IP,
    the consent text and an audit trail against a document that does not exist.
    """
    from fastapi import HTTPException

    pool = _pool_returning(["t1"])
    with pytest.raises(HTTPException) as exc:
        await esign.send_for_signature(
            pool, {**CONTRACT, "file_key": ""}, SIGNERS[:1], "user-1",
        )

    assert exc.value.status_code == 409
    assert sent == [], "an email went out for a contract with nothing to sign"
    # WRITES, not queries. This asserted `pool.queries == []`, which also
    # forbade reading — and the "already sent" guard reads before it refuses.
    # The property worth protecting is that a refused request leaves nothing
    # behind, and a SELECT leaves nothing behind.
    writes = [q for q in pool.queries
              if q.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]
    assert writes == [], f"rows were written for a request that was refused: {writes}"


@pytest.mark.asyncio
async def test_a_document_that_cannot_be_read_is_refused(sent, monkeypatch):
    """No bytes, no hash; no hash, no tamper evidence.

    `file_hash` is what the audit certificate publishes as `original_file_hash`
    and it is the whole of the IT Act §10A claim that alterations are
    detectable. Storing a placeholder would leave the certificate asserting
    something untrue about a document nobody can produce.
    """
    from fastapi import HTTPException
    import services.storage as storage

    async def _gone(key, org_id=None, url=None):
        return None

    monkeypatch.setattr(storage, "download_file", _gone)
    pool = _pool_returning(["t1"])

    with pytest.raises(HTTPException) as exc:
        await esign.send_for_signature(pool, CONTRACT, SIGNERS[:1], "user-1")

    assert exc.value.status_code == 409
    assert sent == []


@pytest.mark.asyncio
async def test_the_stored_hash_is_of_the_actual_bytes(sent, monkeypatch):
    """Not of the URL, the key, or an empty string."""
    import hashlib
    import services.storage as storage

    payload = b"%PDF-1.7 a specific contract"

    async def _dl(key, org_id=None, url=None):
        return payload

    monkeypatch.setattr(storage, "download_file", _dl)
    pool = _pool_returning(["t1"])

    await esign.send_for_signature(pool, CONTRACT, SIGNERS[:1], "user-1")

    assert esign.hash_pdf(payload) == hashlib.sha256(payload).hexdigest()


def test_the_document_row_points_back_at_the_contract():
    """Pure, because this is the join the firm-side drawer depends on.

    Without `source_module`/`source_id` the document is created, the signer can
    sign it, and the contract can never find it again: its own module would
    report no signature request on a contract that has one out.
    """
    fields = esign.contract_document_fields(CONTRACT, "abc123", 2, "user-1")

    assert fields["source_module"] == esign.SOURCE_GANIT_CONTRACT
    assert fields["source_id"] == CONTRACT["id"]
    assert fields["file_key"] == CONTRACT["file_key"]
    assert fields["file_hash"] == "abc123"
    assert fields["signers_total"] == 2
    # 'draft' would show in the e-Sign module as an unsent draft the firm never
    # made, and would be skipped by the expiry transition on the read path.
    assert fields["status"] == "sent"


class _DocPool:
    """A pool that answers with one document row and records what was written."""

    def __init__(self, doc_status="sent", contract=True, source="ganit_contract"):
        self.doc_status = doc_status
        self.contract = contract
        self.source = source
        self.executed = []

    async def fetchval(self, q, *a, **k):
        return 1 if self.contract else None

    async def fetchrow(self, q, *a, **k):
        if "source_module, source_id" in q:
            return _Row(source_module=self.source,
                        source_id="c0000000-0000-0000-0000-000000000001")
        return _Row(id="d0000000-0000-0000-0000-000000000009", status=self.doc_status)

    async def fetch(self, q, *a, **k):
        return []

    async def execute(self, q, *a, **k):
        self.executed.append(q)
        return "UPDATE 1"


@pytest.mark.asyncio
async def test_an_executed_contract_cannot_be_withdrawn():
    """'Withdrawn' beside a document carrying real signatures is a lie.

    The drawer hides the button once everyone has signed; the endpoint is
    callable without the drawer.
    """
    from fastapi import HTTPException

    pool = _DocPool(doc_status="completed")
    with pytest.raises(HTTPException) as exc:
        await esign.cancel_signature(pool, CONTRACT["id"], CONTRACT["org_id"], "user-1")

    assert exc.value.status_code == 409
    assert pool.executed == [], "the contract's status was rewritten anyway"


@pytest.mark.asyncio
async def test_withdrawing_stops_the_document_and_not_just_the_contract():
    """Setting only the contract's status is a withdrawal the signer never sees.

    `_doc_status_guard` reads `sign_documents.status`; a link stays live until
    THAT says cancelled.
    """
    pool = _DocPool(doc_status="sent")
    await esign.cancel_signature(pool, CONTRACT["id"], CONTRACT["org_id"], "user-1")

    wrote = " ".join(pool.executed)
    assert "staging.ganit_contracts" in wrote
    assert "staging.sign_documents" in wrote, (
        "the contract says cancelled and the document does not — the signing "
        "links go on working"
    )


@pytest.mark.asyncio
async def test_completion_reaches_the_contract_that_asked_for_it():
    """Otherwise the contract stays 'pending' beside its own executed PDF."""
    pool = _DocPool()
    await esign.mark_source_signed(pool, "d0000000-0000-0000-0000-000000000009")

    wrote = " ".join(pool.executed)
    assert "staging.ganit_contracts" in wrote
    assert "signature_status='signed'" in wrote


@pytest.mark.asyncio
async def test_a_document_with_no_source_is_left_alone():
    """The common case — a document created in the e-Sign module itself."""
    pool = _DocPool(source=None)
    await esign.mark_source_signed(pool, "d0000000-0000-0000-0000-000000000009")

    assert pool.executed == []


def test_send_email_is_imported_from_the_module_that_exists():
    """The original imported `services.email_service`, which does not exist.

    Asserted at module scope rather than inside a try, so a wrong path fails at
    import time instead of silently at send time.
    """
    import email_service
    assert esign.send_email is email_service.send_email

    with pytest.raises(ModuleNotFoundError):
        __import__("services.email_service")
