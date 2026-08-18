"""The three e-sign facts now EMIT, from inside the write's own transaction.

`document.sent`, `document.signed` and `document.declined` were declared in
`services/niyam/subjects.py` with no caller anywhere — the exact "offered but
never emitted" defect the registry's UNWIRED set exists to hold at bay
(`document.expiring` stays there: it is a sweep predicate, not a router's).
This file pins the wiring in `routers/esign.py`:

  * the happy path calls the emitter ON THE CONNECTION the business write
    used — the fake pool lends ITSELF out as the connection, so an identity
    assertion is the proof that the emit rides the write's transaction rather
    than a second connection that could commit when the write did not;
  * every refusal path emits NOTHING. An event about a write that was refused
    is precisely the lie the outbox design exists to prevent.

The emitters are monkeypatched in the ROUTER's namespace — `routers/esign.py`
imports them at module level for exactly this reason — so nothing here reaches
into `services.niyam`, and nothing here proves anything about payload shapes:
that discipline lives inside the emitters and their own tests. What is proved
is the ARGUMENTS: honest values read off the rows the handler already holds.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import routers.esign as esign


DOC_ID = uuid.UUID("00000000-0000-0000-0000-0000000000dd")
SIGNER_ID = uuid.UUID("00000000-0000-0000-0000-0000000000aa")
ORG_ID = "00000000-0000-0000-0000-000000000001"
USER = {"user_id": "user_admin001"}
OPEN = datetime.now(timezone.utc) + timedelta(days=5)


class _Req:
    """Only what the endpoints touch: client IP, headers, and a JSON body."""
    class _C:
        host = "203.0.113.9"
    client = _C()
    headers = {"user-agent": "pytest", "content-type": "application/json"}

    async def json(self):
        return {"reason": "price too high"}


class _Pool:
    """The fake-pool idiom from test_target_attainment.py.

    Every call lands in one ledger, and `acquire()` lends the POOL ITSELF out
    as the connection — so asserting the emitter received this exact object
    proves it was handed the business write's own connection. `rows` and
    `lists` map a distinctive SQL fragment to the row(s) that query returns.
    """

    def __init__(self):
        self.calls = []
        self.rows = {}
        self.lists = {}

    @staticmethod
    def _match(table, q):
        for frag, row in table.items():
            if frag in q:
                return row
        return None

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return self._match(self.rows, q)

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return self._match(self.lists, q) or []

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return None

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


class _Emit:
    """Stands in for a subjects.py emitter; records (conn, kwargs)."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, kw))
        return 1


def _doc_row(**over):
    row = {
        "id": DOC_ID, "org_id": uuid.UUID(ORG_ID),
        "title": "MSA — Aekam x Client", "description": "",
        "status": "draft", "file_key": "esign/originals/x.pdf",
        "file_url": "https://r2.example/x.pdf", "file_hash": "h",
        "signers_total": 2, "signers_completed": 0,
        "expires_at": OPEN, "created_by": USER["user_id"],
        "source_module": None,
    }
    row.update(over)
    return row


def _signer_row(**over):
    row = {
        "id": SIGNER_ID, "document_id": DOC_ID, "doc_id": DOC_ID,
        "name": "Asha Rao", "email": "asha@bigclient.example",
        "phone": None, "sign_order": 1, "token": "tok",
        "status": "opened", "otp_verified": True, "signed_at": None,
        "signers_total": 2, "signers_completed": 0,
        "org_id": uuid.UUID(ORG_ID),
        "file_key": "k", "file_url": "u", "file_hash": "h",
        "doc_status": "sent", "expires_at": OPEN,
    }
    row.update(over)
    return row


def _install(monkeypatch, pool):
    async def _get_pool():
        return pool
    monkeypatch.setattr(esign, "get_pool", _get_pool)


@pytest.fixture
def sources(monkeypatch):
    """`_doc_for_reader` asks which source modules the caller may see."""
    import services.esign_service as svc

    async def _all(pool, user_id, org_id):
        return ["ganit_contract"]
    monkeypatch.setattr(svc, "visible_source_modules", _all)


@pytest.fixture
def no_mail(monkeypatch):
    """The send route mails every signer; keep that off the wire."""
    import email_service
    sent = []
    monkeypatch.setattr(email_service, "send_email", lambda **kw: sent.append(kw))
    return sent


# ── document.sent ─────────────────────────────────────────────────────────────

def _send_pool():
    pool = _Pool()
    # _doc_for_reader's SELECT carries the org predicate; the flip is the UPDATE.
    pool.rows["AND org_id=$2::uuid"] = _doc_row()
    pool.rows["SET status='sent'"] = _doc_row(status="sent")
    pool.lists["FROM staging.sign_signers WHERE document_id=$1"] = [_signer_row(status="pending")]
    return pool


@pytest.mark.asyncio
async def test_sending_emits_document_sent_on_the_writes_own_connection(
        monkeypatch, sources, no_mail):
    pool = _send_pool()
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_sent", emit)

    out = await esign.send_for_signing(str(DOC_ID), user=USER, org_id=ORG_ID)

    assert out["status"] == "sent"
    assert len(emit.calls) == 1, "sending must emit exactly once"
    conn, kw = emit.calls[0]
    assert conn is pool, "the emitter was not handed the write's own connection"
    assert kw["org_id"] == ORG_ID
    assert kw["actor_id"] == USER["user_id"], \
        "the person pressing send is the actor — the last e-sign event that has one"
    assert kw["document_id"] == DOC_ID
    assert kw["row"]["status"] == "sent", "the row must be the row AS FLIPPED"
    assert kw["row"]["signers_total"] == 2
    assert any("SET status='sent'" in q and "RETURNING *" in q for q, _ in pool.calls), \
        "the flip no longer returns the row the emitter needs"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "doc,code",
    [
        (None, 404),                              # not visible to this caller
        (_doc_row(status="sent"), 400),           # already sent
        (_doc_row(file_key="pending"), 400),      # nothing uploaded yet
    ],
    ids=["not-found", "already-sent", "no-file"],
)
async def test_a_refused_send_emits_nothing(monkeypatch, sources, no_mail, doc, code):
    pool = _send_pool()
    pool.rows["AND org_id=$2::uuid"] = doc
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_sent", emit)

    with pytest.raises(esign.HTTPException) as e:
        await esign.send_for_signing(str(DOC_ID), user=USER, org_id=ORG_ID)

    assert e.value.status_code == code
    assert emit.calls == [], "a refused send must not announce a send"


# ── document.signed ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_signature_emits_document_signed_with_the_remaining_count(monkeypatch):
    pool = _Pool()
    pool.rows["s.token=$1"] = _signer_row()
    pool.rows["UPDATE staging.sign_documents SET signers_completed"] = _doc_row(
        status="partially_signed", signers_completed=1)
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_signed", emit)

    out = await esign.submit_signature(
        "tok", esign.SignatureSubmit(signature_data="Asha Rao", signature_type="type"),
        _Req(),
    )

    assert out["signed"] is True
    assert len(emit.calls) == 1
    conn, kw = emit.calls[0]
    assert conn is pool, "the emitter was not handed the write's own connection"
    assert kw["org_id"] == ORG_ID, "the org comes off the document row — no org dependency here"
    assert kw["document_id"] == DOC_ID
    assert kw["signer_email"] == "asha@bigclient.example", \
        "the FULL address goes in; the emitter keeps only the domain"
    assert kw["remaining_signers"] == 1, \
        "remaining must be read off the row as written in the same transaction"
    assert kw["source"] == "import", "an external signer is not an app actor"
    assert "actor_id" not in kw, "an external signer has no actor to invent"
    assert kw["row"]["title"], "the emitter reads the title off the document row"


@pytest.mark.asyncio
async def test_the_last_signature_reports_zero_remaining(monkeypatch):
    pool = _Pool()
    pool.rows["s.token=$1"] = _signer_row(signers_total=1)
    pool.rows["UPDATE staging.sign_documents SET signers_completed"] = _doc_row(
        status="completed", signers_total=1, signers_completed=1)
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_signed", emit)

    # Completion side effects (artefacts, the source row) are other tests'
    # subjects; here they would only drag storage into a wiring test.
    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(esign, "_generate_completion_artefacts", _noop)
    import services.esign_service as svc
    monkeypatch.setattr(svc, "mark_source_signed", _noop)

    out = await esign.submit_signature(
        "tok", esign.SignatureSubmit(signature_data="Asha Rao"), _Req(),
    )

    assert out["document_status"] == "completed"
    assert len(emit.calls) == 1
    assert emit.calls[0][1]["remaining_signers"] == 0, \
        "'that was the last one' is the rule everybody actually wants"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "over,code",
    [
        ({"status": "signed"}, 400),
        ({"otp_verified": False}, 403),
        ({"doc_status": "cancelled"}, 410),
        ({"expires_at": datetime.now(timezone.utc) - timedelta(days=1)}, 410),
    ],
    ids=["already-signed", "no-otp", "cancelled", "expired"],
)
async def test_a_refused_signature_emits_nothing_and_writes_nothing(monkeypatch, over, code):
    pool = _Pool()
    pool.rows["s.token=$1"] = _signer_row(**over)
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_signed", emit)

    with pytest.raises(esign.HTTPException) as e:
        await esign.submit_signature(
            "tok", esign.SignatureSubmit(signature_data="x", signature_type="type"),
            _Req(),
        )

    assert e.value.status_code == code
    assert emit.calls == [], "a refused signature must not announce a signature"
    assert not any("UPDATE" in q for q, _ in pool.calls), \
        "a refusal path wrote something"


# ── document.declined ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_decline_emits_document_declined_with_the_reason(monkeypatch):
    pool = _Pool()
    pool.rows["s.token=$1"] = _signer_row()
    pool.rows["SELECT * FROM staging.sign_documents WHERE id=$1"] = _doc_row(status="sent")
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_declined", emit)

    out = await esign.decline_signing("tok", _Req())

    assert out == {"declined": True}
    assert len(emit.calls) == 1
    conn, kw = emit.calls[0]
    assert conn is pool, "the emitter was not handed the write's own connection"
    assert kw["org_id"] == ORG_ID, "the org comes off the document row"
    assert kw["document_id"] == DOC_ID
    assert kw["declined_reason"] == "price too high", \
        "the reason is the one fact the sender needs routed"
    assert kw["source"] == "import"
    assert "actor_id" not in kw
    assert kw["row"]["title"]
    assert any("SET status='declined'" in q for q, _ in pool.calls), \
        "the decline write itself is gone"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "over,code",
    [
        ({"status": "signed"}, 400),
        ({"doc_status": "cancelled"}, 410),
        ({"doc_status": "expired"}, 410),
    ],
    ids=["already-signed", "cancelled", "expired"],
)
async def test_a_refused_decline_emits_nothing_and_writes_nothing(monkeypatch, over, code):
    pool = _Pool()
    pool.rows["s.token=$1"] = _signer_row(**over)
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_declined", emit)

    with pytest.raises(esign.HTTPException) as e:
        await esign.decline_signing("tok", _Req())

    assert e.value.status_code == code
    assert emit.calls == [], "a refused decline must not announce a decline"
    assert not any("UPDATE" in q for q, _ in pool.calls)


# ── the wiring is transactional, not decorative ──────────────────────────────

def test_no_emitter_is_wrapped_in_a_try_except():
    """A failed emit must not be swallowed by the ROUTER — the savepoint inside
    `emit_event` is the containment, and the shared transaction is the
    guarantee. A try/except around the call site would quietly re-introduce
    'the event maybe happened' at exactly the layer built to end it."""
    import ast
    import inspect
    import textwrap

    for handler in (esign.send_for_signing, esign.submit_signature, esign.decline_signing):
        tree = ast.parse(textwrap.dedent(inspect.getsource(handler)))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Try):
                continue
            for inner in ast.walk(node):
                if isinstance(inner, ast.Call):
                    name = getattr(inner.func, "id", getattr(inner.func, "attr", ""))
                    assert not name.startswith("document_"), (
                        f"{handler.__name__} wraps {name} in try/except — the "
                        f"transaction, not a swallow, is the failure contract"
                    )
