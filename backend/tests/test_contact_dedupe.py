"""
Tests for services/contact_dedupe.py

Covers the pure normalizers, which MUST stay byte-identical to the
email_norm / phone_norm generated columns in migration 024. If these drift,
write-time dedupe and the /contacts/duplicates review queue silently disagree
about what counts as a duplicate.

The expected values below are not invented — they are what Postgres actually
produced for the same inputs when migration 024 was applied inside a
rolled-back transaction on the live schema.
"""
import pytest

from services.contact_dedupe import (
    COMPANY_SIMILARITY_THRESHOLD,
    NAME_SIMILARITY_THRESHOLD,
    normalize_email,
    normalize_phone,
)


class TestNormalizePhone:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            # The India variants this exists to collapse. A WhatsApp contact
            # arrives as +91…, a web form as 0…, an import as a bare 10-digit.
            ("+91 98765 43210", "9876543210"),
            ("098765-43210", "9876543210"),
            ("00919876543210", "9876543210"),
            ("9876543210", "9876543210"),
            ("+91-98765-43210", "9876543210"),
            ("(+91) 98765 43210", "9876543210"),
            ("9000000001", "9000000001"),
        ],
    )
    def test_india_variants_collapse_to_same_key(self, raw, expected):
        assert normalize_phone(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            "912345",   # 6 digits — too short to be a subscriber number
            "12345",
            "",
            None,
            "abc",
            "+91",
            "   ",
        ],
    )
    def test_short_or_empty_returns_none(self, raw):
        """
        Must be None, never a truncated string. right('123', 10) returns '123'
        in SQL, so without the length guard every short/garbage value would
        collide with every other short value and mass-merge unrelated people.
        """
        assert normalize_phone(raw) is None

    def test_different_numbers_do_not_collide(self):
        assert normalize_phone("9876543210") != normalize_phone("9000000001")

    def test_last_ten_digits_win_for_country_prefixes(self):
        # 0091 / +91 / 91 prefixes all reduce to the same subscriber number.
        keys = {
            normalize_phone("00919876543210"),
            normalize_phone("+919876543210"),
            normalize_phone("919876543210"),
            normalize_phone("9876543210"),
        }
        assert keys == {"9876543210"}


class TestNormalizeEmail:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("Rajesh@Example.COM ", "rajesh@example.com"),
            ("rajesh@example.com", "rajesh@example.com"),
            ("  X@Y.com", "x@y.com"),
            ("MiXeD@CaSe.In", "mixed@case.in"),
        ],
    )
    def test_lowercased_and_trimmed(self, raw, expected):
        assert normalize_email(raw) == expected

    @pytest.mark.parametrize("raw", ["", None, "   "])
    def test_blank_returns_none(self, raw):
        """Blank must collapse to None so empty emails never match each other."""
        assert normalize_email(raw) is None


class TestFuzzyThresholds:
    """
    Guards the calibration. These constants were measured against pg_trgm on
    the live DB, not guessed — an earlier guess of 0.85/0.80 silently failed to
    catch real typos ('Rajesh Kumaar' scores 0.800).

    Measured similarity, for reference:
        Rajesh Kumar / Rajesh Kumaar          0.800  same person  (catch)
        Sunil Mehta  / Sunil Mehtaa           0.786  same person  (catch)
        Rajesh Kumar / Ramesh Kumar           0.625  DIFFERENT    (reject)
        Acme Traders / Acme Traders Pvt Ltd   0.619  same company (catch)
        Rajesh Kumar / Rajesh K               0.571  same person  (known miss)
        Amit Shah    / Amit Sharma            0.571  DIFFERENT    (reject)
    """

    def test_name_threshold_sits_in_the_only_clean_gap(self):
        worst_false_positive = 0.625   # Ramesh Kumar vs Rajesh Kumar
        worst_true_positive = 0.786    # Sunil Mehtaa vs Sunil Mehta
        assert worst_false_positive < NAME_SIMILARITY_THRESHOLD < worst_true_positive, (
            "NAME_SIMILARITY_THRESHOLD must separate one-letter-different real "
            "people (Rajesh/Ramesh) from genuine typos (Mehta/Mehtaa)."
        )

    def test_company_threshold_tolerates_pvt_ltd_suffix(self):
        # 'Acme Traders' vs 'Acme Traders Pvt Ltd' = 0.619. The suffix is near
        # universal in India; a stricter company threshold would reject real
        # matches. Name carries the precision.
        assert COMPANY_SIMILARITY_THRESHOLD < 0.619

    def test_company_threshold_still_rejects_unrelated_firms(self):
        # 'Acme Traders' vs 'Acme Exports' = 0.238
        assert COMPANY_SIMILARITY_THRESHOLD > 0.238
