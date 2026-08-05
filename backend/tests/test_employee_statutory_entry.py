"""The statutory identifiers an admin can now enter, and what is refused.

The hole this closes
--------------------
Vetana deducted provident fund, printed it on the payslip, and attached an
advisory telling the admin to set the employee's UAN at "Manav → Employees →
the employee's record". The columns existed. The API accepted the fields. The
form had no input for any of them, so the instruction on the payslip was false.
Measured on the shared database 2026-08-05, before this was built:

    81 employees · 0 with a UAN · 0 with an ESI number · 1 with a bank account
    998 payslips · 991 deducting PF from someone with no UAN · 720 disbursed
    against an employee with no account number on file

Why the tests are shaped like this
----------------------------------
`routers/messaging.py:30-41` records what the mocked pool is worth: every read
endpoint there once answered 500 against a real database with the whole suite
green, because a mocked cursor resolves any table name handed to it. So the
rules worth proving live in `services/statutory_ids.py` as pure functions and
are tested directly. The HTTP tests below prove only what HTTP can prove — that
the handler asks the validator, and that a refusal reaches the caller as a 422
rather than a row.
"""
import os

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret-minimum-32-chars-long-xxxx")

from services import encryption
from services.encryption import is_encrypted
from services.pii import decrypt_bank, encrypt_bank, mask_bank
from services.statutory_ids import (
    StatutoryValueError,
    clean_account_number,
    clean_bank_details,
    clean_employee_identifiers,
    clean_esi_number,
    clean_ifsc,
    clean_pan,
    clean_uan,
)


def problem_fields(exc: StatutoryValueError) -> set[str]:
    return {p["field"] for p in exc.problems}


# ══════════════════════════════════════════════════════════════════════════════
# The formats
# ══════════════════════════════════════════════════════════════════════════════


class TestUAN:
    """12 digits. The EPFO member number a PF contribution is filed against."""

    def test_twelve_digits_is_accepted(self):
        assert clean_uan("100123456789") == "100123456789"

    def test_it_is_accepted_the_way_it_is_printed(self):
        """Grouped, because that is how it appears on a passbook and a Form 11.
        Refusing the right number for being typed the way it is printed is a
        rule that gets worked around rather than obeyed."""
        assert clean_uan("1001 2345 6789") == "100123456789"
        assert clean_uan("1001-2345-6789") == "100123456789"

    @pytest.mark.parametrize("bad", ["10012345678", "1001234567890", "", " "])
    def test_the_wrong_length_is_refused_or_blank(self, bad):
        if bad.strip():
            with pytest.raises(StatutoryValueError):
                clean_uan(bad)
        else:
            # Blank is a real state — an employee below the PF threshold has no
            # UAN, and `validate_payslip` reports that as advisory, not blocking.
            assert clean_uan(bad) == ""

    def test_letters_are_refused_rather_than_stripped(self):
        """Stripping non-digits would turn 'UAN 100123456789' into a stored
        value and 'abc123456789xyz' into a *different* stored value, both
        silently. The number is copied onto a filing; it is not guessed at."""
        with pytest.raises(StatutoryValueError):
            clean_uan("10012345678X")

    def test_the_message_says_how_many_digits_were_found(self):
        with pytest.raises(StatutoryValueError) as e:
            clean_uan("12345")
        assert "5 digit(s)" in str(e.value)


class TestESINumber:
    """10 digits — the EMPLOYEE's insurance number, not the employer's code.

    This is the rule the brief that commissioned the work had wrong, and getting
    it wrong in the obvious direction would have refused every real value an
    admin could type.
    """

    def test_ten_digits_is_accepted(self):
        assert clean_esi_number("3100123456") == "3100123456"

    def test_seventeen_digits_is_refused_because_that_is_the_employer_code(self):
        """The repo says so in its own words:
        `migrations/PROPOSED_080_statutory_document_identifiers.sql` comments
        `organisations.esi_employer_code` as "ESIC employer code, 17 digits. The
        employer half of the payslip statutory block; the employee half is
        manav_employees.esi_number."

        `manav_employees.esi_number` is that employee half. The payslip prints
        it in the employee's own Statutory column beside their own UAN, and
        `validate_payslip` says the contribution "cannot be credited to their
        ESIC record" without it — their record, not the establishment's.
        """
        with pytest.raises(StatutoryValueError) as e:
            clean_esi_number("31000123450001001")
        assert "EMPLOYER code" in str(e.value)

    def test_blank_passes(self):
        assert clean_esi_number("") == ""
        assert clean_esi_number(None) == ""


class TestIFSC:
    """Four letters, a literal zero, six alphanumerics."""

    def test_a_real_ifsc_is_accepted_and_upper_cased(self):
        assert clean_ifsc("hdfc0001234") == "HDFC0001234"

    def test_the_branch_tail_may_carry_letters(self):
        """A digits-only tail is the tempting simplification and it is wrong —
        a minority of branch codes are alphanumeric, and a digits-only rule
        refuses those accounts entirely."""
        assert clean_ifsc("SBIN0A12B34") == "SBIN0A12B34"

    def test_the_fifth_character_must_be_zero(self):
        with pytest.raises(StatutoryValueError) as e:
            clean_ifsc("HDFC1001234")
        assert "fifth character" in str(e.value)

    @pytest.mark.parametrize("bad", ["HDFC000123", "HDFC00012345", "HDF00001234"])
    def test_the_wrong_shape_is_refused(self, bad):
        with pytest.raises(StatutoryValueError):
            clean_ifsc(bad)


class TestAccountNumber:
    """Never truncated. That is the whole rule."""

    def test_a_plain_account_number_is_accepted(self):
        assert clean_account_number("50200041824821") == "50200041824821"

    def test_the_short_account_already_on_this_database_is_accepted(self):
        """The one account on the shared database is EIGHT digits.

        A 9-digit floor is the number usually quoted and it would have refused
        live data the first time somebody edited that record — which is why the
        floor was measured rather than assumed.
        """
        assert clean_account_number("12345678") == "12345678"

    def test_an_over_long_number_is_refused_and_never_shortened(self):
        """The failure mode this exists to prevent: keeping the first 18
        characters produces a well-formed account number belonging to a
        stranger, which every later check passes."""
        too_long = "1" * 25
        with pytest.raises(StatutoryValueError) as e:
            clean_account_number(too_long)
        assert "NOT been shortened" in str(e.value)

    def test_the_masked_value_is_refused(self):
        """`GET /v1/manav/employees/{id}` returns "••••4821". An edit form that
        prefilled from that read and PATCHed it back would write the mask over
        the only copy of the number, in a save that reports success."""
        with pytest.raises(StatutoryValueError) as e:
            clean_account_number("••••4821")
        assert "masked" in str(e.value)

    def test_non_digits_are_refused_rather_than_stripped(self):
        with pytest.raises(StatutoryValueError):
            clean_account_number("HDFC0001234")


class TestPAN:
    def test_a_real_pan_is_accepted_and_upper_cased(self):
        assert clean_pan("abcpd1234e") == "ABCPD1234E"

    def test_an_invalid_holder_type_is_refused(self):
        """The fourth character is the holder type and only ten letters are
        issued there. 'Z' is not one, so the number does not exist."""
        with pytest.raises(StatutoryValueError) as e:
            clean_pan("ABCZD1234E")
        assert "fourth character" in str(e.value)

    def test_a_company_pan_is_not_refused_for_being_a_company(self):
        """The check is the taxonomy, not a guess that every PAN on an employee
        record must be an individual's. Narrowing it to 'P' would start refusing
        numbers the Income Tax Department issued."""
        assert clean_pan("ABCCD1234E") == "ABCCD1234E"


# ══════════════════════════════════════════════════════════════════════════════
# The composite entry point
# ══════════════════════════════════════════════════════════════════════════════


class TestCleanEmployeeIdentifiers:
    def test_absent_keys_stay_absent(self):
        """It runs over a PATCH body built with `exclude_unset`. A cleaner that
        materialised the keys it did not receive would write blanks over stored
        identifiers on every unrelated edit."""
        out = clean_employee_identifiers({"name": "Priya"})
        assert out == {"name": "Priya"}
        assert "uan" not in out and "bank_details" not in out

    def test_every_problem_is_reported_at_once(self):
        """One round trip per bad field turns a single correction into three."""
        with pytest.raises(StatutoryValueError) as e:
            clean_employee_identifiers({
                "uan": "123",
                "esi_number": "456",
                "bank_details": {"account_number": "abc", "ifsc": "NOPE"},
            })
        assert problem_fields(e.value) == {
            "uan", "esi_number",
            "bank_details.account_number", "bank_details.ifsc",
        }

    def test_an_aadhaar_pasted_into_the_uan_box_is_caught(self):
        """The one data-entry error that produces a WELL-FORMED wrong UAN.

        Both numbers are twelve digits and they sit two fields apart on the same
        form. Every other rule in the module catches a value that is obviously
        broken; nothing downstream would catch this one — the contribution would
        simply be filed against a number EPFO does not know.
        """
        with pytest.raises(StatutoryValueError) as e:
            clean_employee_identifiers({"uan": "234567890123"}, aadhaar="2345 6789 0123")
        assert "Aadhaar" in str(e.value)

    def test_a_different_aadhaar_does_not_trip_it(self):
        out = clean_employee_identifiers({"uan": "100123456789"}, aadhaar="234567890123")
        assert out["uan"] == "100123456789"

    def test_unknown_bank_keys_are_preserved(self):
        """`bank_details` is a shared bag — the organisation's version of the
        same field carries account_name, branch and upi_id. A normaliser that
        dropped what it did not recognise would quietly delete them."""
        out = clean_bank_details({
            "account_number": "12345678", "ifsc": "HDFC0001234",
            "account_name": "Priya Sharma", "branch": "Andheri East",
        })
        assert out["account_name"] == "Priya Sharma"
        assert out["branch"] == "Andheri East"


# ══════════════════════════════════════════════════════════════════════════════
# Encryption at rest
# ══════════════════════════════════════════════════════════════════════════════


class TestAccountNumberAtRest:
    """The account number follows the Aadhaar precedent, not the PAN one.

    `routers/manav.py` recorded why `bank_details` was left in plaintext: the
    readers had not been enumerated. They have been — this file and
    `routers/vetana.py` are the only two that read the value rather than testing
    it for emptiness in SQL — so the stated blocker is discharged.
    """

    def test_the_account_number_is_ciphertext_at_rest(self):
        stored = encrypt_bank({"account_number": "50200041824821", "ifsc": "HDFC0001234"})
        assert is_encrypted(stored["account_number"])
        assert "50200041824821" not in stored["account_number"]

    def test_the_routing_fields_stay_readable(self):
        """The IFSC and the bank name identify a BRANCH, not a person.
        Encrypting them costs the ability to query them and buys nothing."""
        stored = encrypt_bank({"account_number": "50200041824821", "ifsc": "HDFC0001234",
                               "bank_name": "HDFC Bank"})
        assert stored["ifsc"] == "HDFC0001234"
        assert stored["bank_name"] == "HDFC Bank"

    def test_it_round_trips(self):
        original = {"account_number": "50200041824821", "ifsc": "HDFC0001234"}
        assert decrypt_bank(encrypt_bank(original)) == original

    def test_legacy_plaintext_rows_still_read(self):
        """No backfill is required for the field to be readable. `decrypt()`
        passes an unmarked value through unchanged, which is what lets the
        column hold a mix while rows are edited one at a time."""
        assert decrypt_bank({"account_number": "12345678"})["account_number"] == "12345678"

    def test_masking_refuses_to_render_ciphertext_as_an_account_tail(self):
        """The failure `test_aadhaar_encryption.py` names for the Aadhaar
        column, applied here: masking `enc::gAAAAAB…` yields the last four
        characters of a Fernet token, presented exactly where a human reads the
        last four digits of their account. There is no way to tell it apart
        from the outside, so it must never be produced.
        """
        stored = encrypt_bank({"account_number": "50200041824821"})
        masked = mask_bank(stored)
        assert masked["account_number"] == "(encrypted — not decrypted for display)"
        assert not masked["account_number"].endswith("4821")

    def test_masking_a_decrypted_record_still_shows_the_tail(self):
        """The tail is what a human uses to confirm "yes, that is my account".
        The guard above must not have cost it on the correct path."""
        stored = encrypt_bank({"account_number": "50200041824821"})
        assert mask_bank(decrypt_bank(stored))["account_number"].endswith("4821")

    def test_a_json_string_column_does_not_kill_the_record(self):
        """`manav_employees.bank_details` is jsonb but older rows hold a JSON
        *string* — the double-encode bug recorded in `create_employee`. That
        once made `GET /employees/{id}` return 500 for every employee in the
        org. One bad field should cost that field, not the endpoint."""
        assert decrypt_bank('{"account_number": "12345678"}')["account_number"] == "12345678"
        assert encrypt_bank("not json at all") == {}


# ══════════════════════════════════════════════════════════════════════════════
# The handler — only what HTTP can prove
# ══════════════════════════════════════════════════════════════════════════════


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """`_gate` is `require_module_or_self("manav")` and its VALUE is the caller's
    Tier-4 level set. Editing a personnel file needs `admin`; the permission
    rules themselves are `test_manav.py`'s subject, not this file's."""
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


CREATED_ROW = {
    "id": "e0000000-0000-0000-0000-000000000001",
    "name": "Priya", "employee_code": "EMP001",
}


class TestTheHandlerAsksTheValidator:
    async def test_a_malformed_uan_is_refused_with_a_422_naming_the_field(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        r = await api_client.post("/api/v1/manav/employees", json={"name": "Priya", "uan": "123"})
        assert r.status_code == 422
        detail = r.json()["detail"]
        assert detail["error"] == "statutory_identifier_invalid"
        assert detail["problems"][0]["field"] == "uan"

    async def test_nothing_is_written_when_the_identifier_is_refused(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """The point of refusing is that the row does not get the bad value.
        A 422 raised after the INSERT would be a worse bug than no check."""
        mock_pool.fetchrow.reset_mock()
        await api_client.post(
            "/api/v1/manav/employees",
            json={"name": "Priya", "esi_number": "12345678901234567"},
        )
        assert mock_pool.fetchrow.call_count == 0

    async def test_a_well_formed_record_is_accepted(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.return_value = CREATED_ROW
        r = await api_client.post("/api/v1/manav/employees", json={
            "name": "Priya", "uan": "100123456789", "esi_number": "3100123456",
            "bank_details": {"account_number": "50200041824821", "ifsc": "HDFC0001234"},
        })
        assert r.status_code == 200, r.text

    async def test_the_account_number_reaches_the_insert_as_ciphertext(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """The check that a mocked pool CAN honestly make: whatever the database
        does with it afterwards, the value this handler hands over is not the
        number."""
        mock_pool.fetchrow.return_value = CREATED_ROW
        await api_client.post("/api/v1/manav/employees", json={
            "name": "Priya",
            "bank_details": {"account_number": "50200041824821", "ifsc": "HDFC0001234"},
        })
        args = mock_pool.fetchrow.call_args[0]
        banks = [a for a in args if isinstance(a, dict) and "account_number" in a]
        assert banks, "the INSERT no longer binds a bank_details dict"
        assert is_encrypted(banks[0]["account_number"])
        assert "50200041824821" not in str(args)

    async def test_a_patch_merges_the_bank_document_rather_than_replacing_it(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """Correcting the IFSC must not wipe the account number.

        The account comes back from the detail endpoint masked, so a form cannot
        round-trip it; the only safe thing it can send is what was retyped.
        Replacing the whole jsonb with that would destroy the number on every
        such edit — a successful-looking save whose damage appears at the next
        payroll run.
        """
        r = await api_client.patch(
            "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
            json={"bank_details": {"ifsc": "HDFC0001234"}},
        )
        assert r.status_code == 200, r.text
        sql = mock_pool.execute.call_args[0][0]
        assert "bank_details=COALESCE(bank_details, '{}'::jsonb) ||" in sql, (
            "bank_details is being replaced rather than merged"
        )

    async def test_a_patch_that_only_touches_the_name_does_not_go_near_the_bank(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """`exclude_unset` plus a cleaner that materialises nothing. A cleaner
        that filled in the keys it did not receive would write blanks over the
        stored identifiers on every unrelated edit."""
        r = await api_client.patch(
            "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
            json={"name": "Priya Sharma"},
        )
        assert r.status_code == 200, r.text
        sql = mock_pool.execute.call_args[0][0]
        assert "bank_details" not in sql and "uan" not in sql
