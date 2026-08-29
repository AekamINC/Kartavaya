"""The three e-sign facts now EMIT, from inside the write's own transaction.

`document.sent`, `document.signed` and `document.declined` were declared in
`services/niyam/subjects.py` with no caller anywhere — the exact "offered but
never emitted" defect the registry's UNWIRED set exists to hold at bay
(`document.expiring` stays there: it is a sweep predicate, not a router's).
This file pins the wiring in `routers/esign.py`:

  * the happy path calls the emitter ON A CONNECTION THE POOL ACTUALLY LENT,
    while that connection's transaction is OPEN. The previous rig lent the
    POOL ITSELF out as the connection and its transaction() was a stateless
    no-op, so "the emitter got the write's own connection inside its
    transaction" was satisfiable by calling the emitter on the pool with no
    transaction anywhere — a vacuous identity check. Now acquire() hands out
    a distinct `_Conn` (recorded in `pool.lent`), the transaction CM flips
    `in_tx` on that conn, and the recorder captures `in_tx` AT EMIT TIME —
    so the assertion `conn in pool.lent and conn is not pool and in_tx` can
    only be met by an emit riding the write's own open transaction;
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


class _Conn:
    """A lent connection with an identity of its own.

    Proxies every query straight back to the pool's single ledger and its
    SQL-fragment answer tables — all existing answers keep working — but it is
    NOT the pool, and it carries the one bit the old rig could not represent:
    whether ITS transaction is open right now. `in_tx` is flipped by the CM
    below and read by the emit recorder at call time.
    """

    def __init__(self, pool):
        self._pool = pool
        self.in_tx = False

    async def fetchrow(self, q, *a):
        return await self._pool.fetchrow(q, *a)

    async def fetch(self, q, *a):
        return await self._pool.fetch(q, *a)

    async def execute(self, q, *a):
        return await self._pool.execute(q, *a)

    async def fetchval(self, q, *a):
        return await self._pool.fetchval(q, *a)

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(_s):
                conn.in_tx = True
                return _s

            async def __aexit__(_s, *exc):
                conn.in_tx = False
                return False
        return _T()


class _Pool:
    """The fake-pool rig, with acquire() no longer vacuous.

    Every call lands in one ledger; `rows` and `lists` map a distinctive SQL
    fragment to the row(s) that query returns. `acquire()` lends a DISTINCT
    `_Conn` per acquisition and records it in `self.lent` — the pool itself
    deliberately has NO transaction() any more, so an emit handed the pool
    cannot even pretend to be transactional.
    """

    def __init__(self):
        self.calls = []
        self.rows = {}
        self.lists = {}
        self.lent = []

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
                conn = _Conn(pool)
                pool.lent.append(conn)
                return conn

            async def __aexit__(_s, *exc):
                return False
        return _A()


class _Emit:
    """Stands in for a subjects.py emitter; records (conn, in_tx, kwargs).

    `in_tx` is captured AT CALL TIME — the transaction CM resets the flag on
    exit, so inspecting the conn after the handler returned would always read
    False and prove nothing about where the emit happened.
    """

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, getattr(conn, "in_tx", False), kw))
        return 1


def _assert_rode_the_write(pool, conn, in_tx):
    """The three facts that together mean 'the emit rode the write's transaction'."""
    assert conn is not pool, \
        "the emitter was handed the POOL — any later borrower could commit what this write rolled back"
    assert conn in pool.lent, \
        "the emitter's connection was never lent by this pool"
    assert in_tx, \
        "the emit happened OUTSIDE the write's transaction — it could survive a rollback"


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
    pool.lists["FROM public.sign_signers WHERE document_id=$1"] = [_signer_row(status="pending")]
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
    conn, in_tx, kw = emit.calls[0]
    _assert_rode_the_write(pool, conn, in_tx)
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
    # The signer flip is a guarded transition now (AND status != 'signed',
    # RETURNING id) — the rig answers it, or the route correctly refuses
    # before any emit, which is the OTHER test's subject.
    pool.rows["UPDATE public.sign_signers SET"] = {"id": str(SIGNER_ID)}
    pool.rows["UPDATE public.sign_documents SET signers_completed"] = _doc_row(
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
    conn, in_tx, kw = emit.calls[0]
    _assert_rode_the_write(pool, conn, in_tx)
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
    pool.rows["UPDATE public.sign_signers SET"] = {"id": str(SIGNER_ID)}
    pool.rows["UPDATE public.sign_documents SET signers_completed"] = _doc_row(
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
    _assert_rode_the_write(pool, emit.calls[0][0], emit.calls[0][1])
    assert emit.calls[0][2]["remaining_signers"] == 0, \
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


@pytest.mark.asyncio
async def test_a_raced_signer_flip_is_refused_with_400_and_emits_nothing(monkeypatch):
    """The 'Already signed' check at the top reads a PRE-transaction snapshot —
    two replays of one token can both pass it. The truth lives in the guarded
    flip (`AND status != 'signed' ... RETURNING id`): the loser matches zero
    rows, and zero rows must mean 400, no counter movement, and no emit — the
    winner already announced this signature.
    """
    pool = _Pool()
    pool.rows["s.token=$1"] = _signer_row()
    # Deliberately NO answer for the signer flip: the guarded UPDATE returns
    # None, exactly what the loser of the race sees. The counter query HAS an
    # answer on purpose — proving it is never asked, not merely unanswered.
    pool.rows["UPDATE public.sign_documents SET signers_completed"] = _doc_row(
        status="partially_signed", signers_completed=1)
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_signed", emit)

    with pytest.raises(esign.HTTPException) as e:
        await esign.submit_signature(
            "tok", esign.SignatureSubmit(signature_data="Asha Rao", signature_type="type"),
            _Req(),
        )

    assert e.value.status_code == 400
    assert e.value.detail == "Already signed"
    assert emit.calls == [], "the loser of the race must not emit a second document.signed"
    assert any("status != 'signed'" in q and "RETURNING id" in q for q, _ in pool.calls), \
        "the guarded transition itself is gone — the flip is unconditional again"
    assert not any("signers_completed + 1" in q for q, _ in pool.calls), \
        "the loser of the race moved the document counter anyway"


# ── document.declined ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_decline_emits_document_declined_with_the_reason(monkeypatch):
    pool = _Pool()
    pool.rows["s.token=$1"] = _signer_row()
    # The decline write is a guarded transition too (NOT IN signed/declined,
    # RETURNING id) — a replay matches nothing and emits nothing.
    pool.rows["UPDATE public.sign_signers SET status='declined'"] = {"id": str(SIGNER_ID)}
    pool.rows["SELECT * FROM public.sign_documents WHERE id=$1"] = _doc_row(status="sent")
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_declined", emit)

    out = await esign.decline_signing("tok", _Req())

    assert out == {"declined": True}
    assert len(emit.calls) == 1
    conn, in_tx, kw = emit.calls[0]
    _assert_rode_the_write(pool, conn, in_tx)
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


@pytest.mark.asyncio
async def test_a_replayed_decline_is_refused_with_400_and_emits_nothing(monkeypatch):
    """Same transition rule as the sign path: the decline write is guarded
    (`status NOT IN ('signed', 'declined') ... RETURNING id`), so a replay —
    or a decline racing a signature — matches zero rows. Zero rows must mean
    400 and silence: the first decline already emitted, and re-announcing it
    would fire every rule hanging off document.declined twice.
    """
    pool = _Pool()
    pool.rows["s.token=$1"] = _signer_row()
    # NO answer for the guarded decline UPDATE — the replay's view. The
    # document SELECT has an answer on purpose: the proof is that the refusal
    # happens BEFORE the route ever fetches a row for the emitter.
    pool.rows["SELECT * FROM public.sign_documents WHERE id=$1"] = _doc_row(status="sent")
    _install(monkeypatch, pool)
    emit = _Emit()
    monkeypatch.setattr(esign, "document_declined", emit)

    with pytest.raises(esign.HTTPException) as e:
        await esign.decline_signing("tok", _Req())

    assert e.value.status_code == 400
    assert emit.calls == [], "a replayed decline must not emit a second document.declined"
    assert any("NOT IN ('signed', 'declined')" in q and "RETURNING id" in q
               for q, _ in pool.calls), \
        "the guarded transition itself is gone — the decline is unconditional again"
    assert not any("SELECT * FROM public.sign_documents WHERE id=$1" in q
                   for q, _ in pool.calls), \
        "the refused decline still fetched the document row it would have emitted with"


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
