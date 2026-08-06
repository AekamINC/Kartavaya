"""Aadhaar is held as ciphertext, and every read path unwraps it.

The column was kept rather than dropped (see the header of
PROPOSED_063_employee_pii.sql). Encryption is what remains once "do not store
it" is off the table: it defeats a database dump, a leaked read-only connection
string, and Supabase support access. It does not defeat anything that can read
the environment, because that is where the key lives.

Two failure modes drive these tests, both silent by nature:

  · a write path that does not know about encryption stores plaintext, and
    nothing looks wrong until someone dumps the table;
  · a read path that does not decrypt returns `enc::gAAAA…`, and the MASKER
    will happily render its last four characters as though they were the last
    four digits of an Aadhaar number.
"""
import os

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret-minimum-32-chars-long-xxxx")

from services import encryption
from services.encryption import PREFIX, decrypt, encrypt, is_encrypted


class TestTheKeyItself:
    """The key resolution, which is where the silent data loss lives."""

    def test_an_empty_environment_refuses_rather_than_using_a_public_key(self, monkeypatch):
        """sha256("") is a fixed, publicly derivable value.

        The old module-level code produced exactly that when neither variable
        was set, and reported nothing. Data written under it reads as protected
        and is not.
        """
        monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
        monkeypatch.delenv("JWT_SECRET", raising=False)
        encryption._reset_for_tests()
        with pytest.raises(RuntimeError, match="public knowledge"):
            encrypt("1234 5678 9012")
        encryption._reset_for_tests()

    def test_the_jwt_fallback_still_works_but_announces_itself(self, monkeypatch, caplog):
        """Existing WhatsApp tokens are already encrypted under JWT_SECRET, so
        the fallback cannot simply be removed. It can stop being silent."""
        monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
        monkeypatch.setenv("JWT_SECRET", "a-secret-that-is-long-enough-to-use")
        encryption._reset_for_tests()
        with caplog.at_level("WARNING"):
            assert encrypt("value").startswith(PREFIX)
        assert "FIELD_ENCRYPTION_KEY is not set" in caplog.text
        assert encryption.key_source() == "JWT_SECRET"
        encryption._reset_for_tests()

    def test_an_explicit_key_is_preferred_and_reported(self, monkeypatch):
        monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "an-explicit-field-key-value-here")
        monkeypatch.setenv("JWT_SECRET", "a-different-auth-secret-entirely-x")
        encryption._reset_for_tests()
        assert encryption.key_source() == "FIELD_ENCRYPTION_KEY"
        encryption._reset_for_tests()

    def test_a_changed_key_is_detectable_rather_than_silent(self, monkeypatch):
        """The trap this whole design exists to avoid.

        Nothing fails at rotation time. It fails later, on read, and `decrypt`
        returns the ciphertext unchanged — so the only way a caller can tell is
        by asking whether the marker survived.
        """
        monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "the-original-key-long-enough-ok")
        encryption._reset_for_tests()
        stored = encrypt("123456789012")

        monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "a-rotated-key-also-long-enough!")
        encryption._reset_for_tests()
        out = decrypt(stored)
        assert out == stored, "a token that will not open must come back untouched"
        assert is_encrypted(out), "and must remain detectable as ciphertext"
        encryption._reset_for_tests()


class TestTheColumnPlumbing:
    """`_encrypt_cols` / `_decrypt_cols` in routers/manav.py."""

    @pytest.fixture(autouse=True)
    def _key(self, monkeypatch):
        monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "manav-test-key-long-enough-here")
        encryption._reset_for_tests()
        yield
        encryption._reset_for_tests()

    def test_a_write_payload_is_enciphered(self):
        from routers.manav import _encrypt_cols
        out = _encrypt_cols({"name": "Asha", "aadhaar": "123456789012"})
        assert out["aadhaar"].startswith(PREFIX)
        assert "123456789012" not in out["aadhaar"]
        assert out["name"] == "Asha", "untouched columns must stay untouched"

    def test_a_partial_update_without_aadhaar_is_unharmed(self):
        """PATCH sends only changed fields. The helper must not invent one."""
        from routers.manav import _encrypt_cols
        assert _encrypt_cols({"department": "Audit"}) == {"department": "Audit"}

    def test_enciphering_is_idempotent(self):
        """A row read, edited and written back must not double-wrap."""
        from routers.manav import _encrypt_cols
        once = _encrypt_cols({"aadhaar": "123456789012"})
        twice = _encrypt_cols(once)
        assert twice == once

    def test_a_read_is_unwrapped(self):
        from routers.manav import _decrypt_cols, _encrypt_cols
        stored = _encrypt_cols({"aadhaar": "123456789012"})
        assert _decrypt_cols(stored)["aadhaar"] == "123456789012"

    def test_legacy_plaintext_rows_still_read(self):
        """Rows written before the backfill carry no marker. They must survive,
        or the change breaks every existing employee on deploy."""
        from routers.manav import _decrypt_cols
        assert _decrypt_cols({"aadhaar": "123456789012"})["aadhaar"] == "123456789012"

    def test_an_empty_aadhaar_stays_empty(self):
        """Six of the nine live rows hold '' rather than NULL."""
        from routers.manav import _decrypt_cols, _encrypt_cols
        assert _encrypt_cols({"aadhaar": ""})["aadhaar"] == ""
        assert _decrypt_cols({"aadhaar": ""})["aadhaar"] == ""

    def test_an_undecryptable_row_raises_instead_of_serving_ciphertext(self, monkeypatch):
        """The masker would otherwise present four characters of a Fernet token
        as the last four digits of an Aadhaar number."""
        from fastapi import HTTPException
        from routers.manav import _decrypt_cols
        stored = encrypt("123456789012")
        monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "a-rotated-key-also-long-enough!")
        encryption._reset_for_tests()
        with pytest.raises(HTTPException) as exc:
            _decrypt_cols({"aadhaar": stored})
        assert exc.value.status_code == 500
        assert "could not be decrypted" in exc.value.detail


class TestMaskingSeesPlaintext:
    """The ordering bug, which is the one that would ship looking correct."""

    @pytest.fixture(autouse=True)
    def _key(self, monkeypatch):
        monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "manav-test-key-long-enough-here")
        encryption._reset_for_tests()
        yield
        encryption._reset_for_tests()

    def test_masking_after_decrypt_shows_the_real_last_four(self):
        from routers.manav import _decrypt_cols, _encrypt_cols, _mask_employee_pii
        row = _encrypt_cols({"aadhaar": "123456789012", "pan": "ABCDE1234F"})
        masked = _mask_employee_pii(_decrypt_cols(row))
        assert masked["aadhaar"].endswith("9012")
        assert "123456789012" not in masked["aadhaar"]

    def test_masking_ciphertext_directly_does_NOT_produce_the_real_last_four(self):
        """A/B for the ordering. This is what the bug looks like if the
        `_decrypt_cols` call is ever dropped from the detail endpoint: no
        exception, a plausible-looking masked string, and the wrong digits."""
        from routers.manav import _encrypt_cols, _mask_employee_pii
        row = _encrypt_cols({"aadhaar": "123456789012"})
        wrong = _mask_employee_pii(row)
        assert not wrong["aadhaar"].endswith("9012"), (
            "masking ciphertext happened to yield the right digits, which makes "
            "this test blind — change the fixture value"
        )


class TestTheEndpointsThemselves:
    """Through the HTTP handlers, because the helpers above can be perfect and
    still never be called. These are the tests that fail if someone deletes the
    `encrypt(...)` from the INSERT or the `_decrypt_cols(...)` from a read."""

    @pytest.fixture(autouse=True)
    def _key(self, monkeypatch):
        monkeypatch.setenv("FIELD_ENCRYPTION_KEY", "manav-test-key-long-enough-here")
        encryption._reset_for_tests()

        # Whether the org has PAID for Manav is a different gate on the same
        # dependency, and it is not what these tests are about. It calls
        # `fetchrow` too, and `mock_pool.fetchrow` is set here to an employee
        # row — so without this the subscription lookup reads that row, finds
        # no "status" key, and every test in the class dies with a KeyError
        # that looks nothing like the thing under test.
        from datetime import datetime, timezone
        import middleware.subscription as sub
        from tests.conftest import TEST_ORG_ID
        monkeypatch.setattr(
            sub, "_cache", {f"{TEST_ORG_ID}:manav": (datetime.now(timezone.utc), True)}
        )

        yield
        encryption._reset_for_tests()

    async def test_create_never_hands_the_database_a_plaintext_aadhaar(
        self, api_client, mock_pool, as_admin, with_org_id
    ):
        """Inspects the parameters actually bound to the INSERT.

        Asserting on the response body would prove nothing here — the handler
        returns only id/name/employee_code, so a plaintext write looks
        identical from outside. The bound parameter is the only witness.
        """
        # The seat keys answer the attendance-seat read that runs just before the
        # INSERT; `seat_limit: None` is uncapped, so the hire is admitted and this
        # test stays about the bound Aadhaar. `call_args` below is the LAST call,
        # which is still the INSERT.
        mock_pool.fetchrow.return_value = {
            "id": "e001", "name": "Rahul", "employee_code": "EMP002",
            "seat_limit": None, "roster": 0, "exempt": 0, "module_active": True,
        }
        resp = await api_client.post("/api/v1/manav/employees", json={
            "name": "Rahul",
            "email": "rahul@example.com",
            "employee_code": "EMP002",
            "aadhaar": "123456789012",
        })
        assert resp.status_code == 200

        bound = mock_pool.fetchrow.call_args.args
        assert "123456789012" not in [str(a) for a in bound], (
            "the raw Aadhaar was bound to the INSERT — it would be stored as "
            "plaintext"
        )
        assert any(isinstance(a, str) and a.startswith(PREFIX) for a in bound), (
            "no enciphered value reached the INSERT at all"
        )

    async def test_the_detail_endpoint_unwraps_a_stored_row(
        self, api_client, mock_pool, as_admin, with_org_id
    ):
        """A row as it now exists in the table — enciphered — must still mask
        down to the true last four."""
        from tests.test_manav import EMPLOYEE_ROW_WITH_PII
        stored = dict(EMPLOYEE_ROW_WITH_PII)
        stored["aadhaar"] = encrypt("123456789012")
        mock_pool.fetchrow.return_value = stored
        mock_pool.fetch.return_value = []

        resp = await api_client.get(
            "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
        )
        assert resp.status_code == 200
        emp = resp.json()["employee"]
        assert emp["aadhaar"].endswith("9012"), "stored ciphertext was not unwrapped"
        assert PREFIX not in emp["aadhaar"], "ciphertext leaked to the client"
        assert "123456789012" not in emp["aadhaar"], "masking stopped working"

    async def test_a_patch_never_writes_a_plaintext_aadhaar(
        self, api_client, mock_pool, as_admin, with_org_id
    ):
        """The update path builds its SET list from a generic loop over changed
        fields, so it is the one most likely to forget."""
        mock_pool.execute.return_value = "UPDATE 1"
        resp = await api_client.patch(
            "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
            json={"aadhaar": "123456789012"},
        )
        assert resp.status_code == 200
        bound = mock_pool.execute.call_args.args
        assert "123456789012" not in [str(a) for a in bound], (
            "PATCH bound a raw Aadhaar to the UPDATE"
        )
