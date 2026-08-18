"""The public signing endpoints: what a stranger holding a token may still do.

`/api/v1/esign/verify/{token}` and its three POST siblings run with NO session,
for a client's client, where the token is the entire authority to apply a
signature that is binding under the IT Act, 2000. Two properties are asserted
here because both were violated and neither is visible from the read path:

  1. A document that is cancelled or expired is not signable. `get_signing_page`
     enforced this; `submit_signature` and `decline_signing` did not look at
     `sign_documents.status` or `expires_at` at all. The page is fetched once and
     may sit open for days, and the POST can be replayed with no page at all, so
     a signer who opened a link before the firm cancelled it could still have a
     signature recorded — with a full audit trail attesting to it. A withdrawal
     the signing endpoint ignores is not a withdrawal.

  2. The OTP attempt window ROLLS. The limiter refreshed `first_at` only when
     `count == 1` and never reset `count`, so once the first 15 minutes elapsed
     the guard `count >= 5 AND elapsed < 900` could never be true again and the
     token accepted unlimited guesses at a 6-digit code, permanently.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import routers.esign as esign


DOC_ID = uuid.UUID("00000000-0000-0000-0000-0000000000dd")
SIGNER_ID = uuid.UUID("00000000-0000-0000-0000-0000000000aa")
OPEN = datetime.now(timezone.utc) + timedelta(days=5)
LAPSED = datetime.now(timezone.utc) - timedelta(days=1)


class _Req:
    """Only what the endpoints touch: client IP and the user-agent header."""
    class _C:
        host = "203.0.113.9"
    client = _C()
    headers = {"user-agent": "pytest", "content-type": "application/json"}

    async def json(self):
        return {"reason": "no"}


def _signer(**over):
    row = {
        "id": SIGNER_ID, "document_id": DOC_ID, "doc_id": DOC_ID,
        "name": "Asha Rao", "email": "asha@example.invalid",
        "status": "opened", "otp_verified": True,
        "otp_code": "123456",
        "otp_expires_at": datetime.now(timezone.utc) + timedelta(minutes=9),
        "signed_at": None, "signers_total": 2, "signers_completed": 0,
        "org_id": "00000000-0000-0000-0000-000000000001",
        "file_key": "k", "file_url": "u", "file_hash": "h",
        "doc_status": "sent", "expires_at": OPEN,
    }
    row.update(over)
    return row


def _pool_for(row):
    class _P:
        executed = []

        async def fetchrow(self, q, *_a, **_k):
            # Writes travel through fetchrow (guarded UPDATE ... RETURNING)
            # since the race fixes — record them in the same ledger the
            # assertions read.
            if q.lstrip().upper().startswith("UPDATE"):
                self.executed.append(q)
            # The document counter is arithmetic IN the UPDATE now
            # (signers_completed+1, status derived in SQL) — answer it the
            # way the database would, or the response reads the un-moved
            # fixture and every "it signed" assertion counts zero.
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
            # emit_event writes through fetchval; a fake int is an event id.
            return 1

        async def execute(self, q, *_a, **_k):
            self.executed.append(q)
            return None

        async def fetch(self, *_a, **_k):
            return []

        # The signing write runs in a transaction with its Niyam emitter now
        # (test_niyam_wiring_esign.py owns that path) — the proxy idiom from
        # test_target_attainment._Pool keeps this fake answering.
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
    """Every test installs its own pool; none of them reach a database."""
    def _install(row):
        pool = _pool_for(row)

        async def _get_pool():
            return pool

        monkeypatch.setattr(esign, "get_pool", _get_pool)
        return pool

    return _install


# ── 1 · the document must still be open ───────────────────────────────────────

def test_the_guard_refuses_a_cancelled_document():
    with pytest.raises(esign.HTTPException) as e:
        esign._doc_status_guard("cancelled", OPEN)
    assert e.value.status_code == 410


def test_the_guard_refuses_a_lapsed_expiry_even_when_status_looks_open():
    with pytest.raises(esign.HTTPException) as e:
        esign._doc_status_guard("sent", LAPSED)
    assert e.value.status_code == 410


def test_the_guard_permits_an_open_document():
    assert esign._doc_status_guard("sent", OPEN) is None
    assert esign._doc_status_guard("partially_signed", None) is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "over",
    [
        {"doc_status": "cancelled"},
        {"doc_status": "expired"},
        {"expires_at": LAPSED},
    ],
    ids=["cancelled", "expired", "past-expiry"],
)
async def test_a_withdrawn_document_cannot_be_signed(no_pool, over):
    """The regression: this POST used to succeed and write status='signed'."""
    pool = no_pool(_signer(**over))

    with pytest.raises(esign.HTTPException) as e:
        await esign.submit_signature(
            "tok", esign.SignatureSubmit(signature_data="Asha Rao", signature_type="type"), _Req(),
        )

    assert e.value.status_code == 410
    assert not any("SET status='signed'" in q or "status='signed'" in q
                   for q in pool.executed), "a withdrawn document was signed anyway"


@pytest.mark.asyncio
async def test_a_withdrawn_document_cannot_be_declined(no_pool):
    """A decline on a cancelled document writes a misleading audit row."""
    no_pool(_signer(doc_status="cancelled"))

    with pytest.raises(esign.HTTPException) as e:
        await esign.decline_signing("tok", _Req())
    assert e.value.status_code == 410


@pytest.mark.asyncio
async def test_an_open_document_still_signs(no_pool):
    """The guard must not have closed the ordinary path."""
    pool = no_pool(_signer())

    out = await esign.submit_signature(
        "tok", esign.SignatureSubmit(signature_data="Asha Rao", signature_type="type"), _Req(),
    )

    assert out["signed"] is True
    assert out["signers_completed"] == 1
    assert any("status='signed'" in q for q in pool.executed)


@pytest.mark.asyncio
async def test_signing_still_requires_otp_verification(no_pool):
    no_pool(_signer(otp_verified=False))
    with pytest.raises(esign.HTTPException) as e:
        await esign.submit_signature(
            "tok", esign.SignatureSubmit(signature_data="x", signature_type="type"), _Req(),
        )
    assert e.value.status_code == 403


# ── 2 · the OTP attempt window rolls ──────────────────────────────────────────

@pytest.fixture(autouse=True)
def _clean_attempts():
    """The limiter's state is a function attribute, so it leaks between tests."""
    if hasattr(esign.verify_otp, "_attempts"):
        del esign.verify_otp._attempts
    yield
    if hasattr(esign.verify_otp, "_attempts"):
        del esign.verify_otp._attempts


async def _guess(token="tok"):
    return await esign.verify_otp(token, esign.OTPVerify(otp="000000"), _Req())


@pytest.mark.asyncio
async def test_five_wrong_codes_then_lockout(no_pool):
    no_pool(_signer())
    for _ in range(5):
        with pytest.raises(esign.HTTPException) as e:
            await _guess()
        assert e.value.status_code == 400, "a wrong code is a 400"
    with pytest.raises(esign.HTTPException) as e:
        await _guess()
    assert e.value.status_code == 429


@pytest.mark.asyncio
async def test_the_limiter_still_blocks_in_a_later_window(no_pool):
    """THE REGRESSION.

    Old behaviour: once the first 15-minute window lapsed, `count` stayed at 5
    and `first_at` was never refreshed, so `elapsed < 900` was permanently False
    and the 429 never fired again — unlimited guesses at a 10^6 space.
    """
    no_pool(_signer())
    for _ in range(5):
        with pytest.raises(esign.HTTPException):
            await _guess()
    with pytest.raises(esign.HTTPException) as e:
        await _guess()
    assert e.value.status_code == 429

    # Age the window past 900s, as wall-clock would.
    esign.verify_otp._attempts["otp_attempts:tok"]["first_at"] -= timedelta(seconds=901)

    # A fresh window opens: the next five are allowed again...
    for _ in range(5):
        with pytest.raises(esign.HTTPException) as e:
            await _guess()
        assert e.value.status_code == 400
    # ...and the sixth is refused. Previously this was a 400 forever.
    with pytest.raises(esign.HTTPException) as e:
        await _guess()
    assert e.value.status_code == 429


@pytest.mark.asyncio
async def test_lapsed_windows_are_evicted(no_pool):
    """The key is chosen by an unauthenticated caller; the dict must not grow."""
    no_pool(_signer())
    with pytest.raises(esign.HTTPException):
        await _guess("aaa")
    esign.verify_otp._attempts["otp_attempts:aaa"]["first_at"] -= timedelta(seconds=901)

    with pytest.raises(esign.HTTPException):
        await _guess("bbb")

    assert "otp_attempts:aaa" not in esign.verify_otp._attempts
    assert "otp_attempts:bbb" in esign.verify_otp._attempts


@pytest.mark.asyncio
async def test_the_correct_code_verifies(no_pool):
    pool = no_pool(_signer())
    out = await esign.verify_otp("tok", esign.OTPVerify(otp="123456"), _Req())
    assert out == {"verified": True}
    assert any("otp_verified=TRUE" in q for q in pool.executed)
