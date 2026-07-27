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
"""
import pytest

import services.esign_service as esign


class _Row(dict):
    """asyncpg rows are mapping-like; the code reads them by key."""


def _pool_returning(tokens):
    """A pool whose INSERT hands back a different token per call, in order.

    The row id deliberately does NOT embed the token: the leak test greps the
    returned structure for token strings, and an id like `id-tok-aaa` would make
    it fail on the fixture rather than on the code.
    """
    calls = iter(enumerate(tokens))

    class _P:
        async def fetchrow(self, *a, **k):
            i, tok = next(calls)
            return _Row(id=f"00000000-0000-0000-0000-{i:012d}", token=tok)

        async def execute(self, *a, **k):
            return None

        async def fetch(self, *a, **k):
            return []

    return _P()


@pytest.fixture
def sent(monkeypatch):
    """Capture every send_email call. Nothing leaves the process."""
    captured = []

    def _fake(to_email, subject, html_content, reply_to=None):
        captured.append({"to": to_email, "subject": subject, "html": html_content})
        return True

    monkeypatch.setattr(esign, "send_email", _fake)
    monkeypatch.setenv("FRONTEND_URL", "https://kartavaya.com")
    return captured


SIGNERS = [
    {"name": "Asha Rao", "email": "asha@example.invalid"},
    {"name": "Vikram Nair", "email": "vikram@example.invalid"},
    {"name": "Priya Shah", "email": "priya@example.invalid"},
]


@pytest.mark.asyncio
async def test_every_signer_gets_their_own_link(sent, monkeypatch):
    """The bug: all three would have received signer 3's token."""
    monkeypatch.setattr(esign, "_log_audit", _noop)
    pool = _pool_returning(["tok-aaa", "tok-bbb", "tok-ccc"])

    created, failed = await esign.send_for_signature(
        pool, "contract-1", SIGNERS, "org-1", "user-1"
    )

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
async def test_no_token_reaches_the_response_body(sent, monkeypatch):
    """`routers/ganit.py` returns this list verbatim as JSON.

    A token in it hands the authority to sign to whoever posted the request.
    """
    monkeypatch.setattr(esign, "_log_audit", _noop)
    pool = _pool_returning(["tok-aaa", "tok-bbb", "tok-ccc"])

    created, _ = await esign.send_for_signature(
        pool, "contract-1", SIGNERS, "org-1", "user-1"
    )

    blob = repr(created)
    for tok in ("tok-aaa", "tok-bbb", "tok-ccc"):
        assert tok not in blob, f"{tok} leaked into the response body"
    assert all(set(c) == {"id", "name", "email"} for c in created)


@pytest.mark.asyncio
async def test_a_failed_send_is_reported_not_swallowed(monkeypatch):
    """The original answered "sent" with zero emails sent. It must not again."""
    monkeypatch.setattr(esign, "_log_audit", _noop)
    monkeypatch.setenv("FRONTEND_URL", "https://kartavaya.com")

    def _refuse(to_email, subject, html_content, reply_to=None):
        if to_email == "vikram@example.invalid":
            return False
        return True

    monkeypatch.setattr(esign, "send_email", _refuse)
    pool = _pool_returning(["t1", "t2", "t3"])

    created, failed = await esign.send_for_signature(
        pool, "contract-1", SIGNERS, "org-1", "user-1"
    )

    assert failed == ["vikram@example.invalid"]
    assert len(created) == 3, "signer rows are valid even when the mail is not"


@pytest.mark.asyncio
async def test_a_raising_send_does_not_abort_the_others(monkeypatch):
    """One bad address must not cost the other signers their email."""
    monkeypatch.setattr(esign, "_log_audit", _noop)
    monkeypatch.setenv("FRONTEND_URL", "https://kartavaya.com")
    seen = []

    def _boom(to_email, subject, html_content, reply_to=None):
        if to_email == "asha@example.invalid":
            raise RuntimeError("provider rejected the address")
        seen.append(to_email)
        return True

    monkeypatch.setattr(esign, "send_email", _boom)
    pool = _pool_returning(["t1", "t2", "t3"])

    created, failed = await esign.send_for_signature(
        pool, "contract-1", SIGNERS, "org-1", "user-1"
    )

    assert failed == ["asha@example.invalid"]
    assert seen == ["vikram@example.invalid", "priya@example.invalid"]


@pytest.mark.asyncio
async def test_the_signer_name_is_escaped(sent, monkeypatch):
    """A name is user-supplied and lands in HTML."""
    monkeypatch.setattr(esign, "_log_audit", _noop)
    pool = _pool_returning(["t1"])

    await esign.send_for_signature(
        pool, "contract-1",
        [{"name": "<script>alert(1)</script>", "email": "x@example.invalid"}],
        "org-1", "user-1",
    )

    assert "<script>" not in sent[0]["html"]
    assert "&lt;script&gt;" in sent[0]["html"]


def test_send_email_is_imported_from_the_module_that_exists():
    """The original imported `services.email_service`, which does not exist.

    Asserted at module scope rather than inside a try, so a wrong path fails at
    import time instead of silently at send time.
    """
    import email_service
    assert esign.send_email is email_service.send_email

    with pytest.raises(ModuleNotFoundError):
        __import__("services.email_service")


async def _noop(*a, **k):
    return None
