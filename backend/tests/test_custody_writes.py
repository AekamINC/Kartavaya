"""THREE REGISTERS THAT COULD BE READ AND NOT WRITTEN.

`services/custody/dsc.py`, `udin.py` and `notices.py` were complete, tested and
routed — twenty read routes, four tabs in Manav — and contained no INSERT at
all. Measured against the live database on 2026-08-21, SELECT only:

    staging.dsc_register      0 rows
    staging.udin_register     0 rows
    staging.notice_register   0 rows

Zero is what a register with a reader and no writer contains, and a register a
firm cannot add to is a compliance claim it cannot actually make. This file
pins the write paths that fixed that, and specifically the judgements they had
to make:

  1. WHICH DSC STATUSES ARE DERIVED. All five, and two of them have a lever —
     `record_revocation` and `record_custody_move` — that the refusal names.
  2. HOW THE UDIN WINDOWS ARE ENFORCED. Both come from `staging.udin_window`,
     both are evaluated against the SERVER's clock, and the 60-day one is the
     only genuinely statutory refusal in the package.
  3. THAT A NOTICE REGISTER NEVER OVERWRITES. Notes are appended, recorded
     dates are kept with COALESCE, and `closed`/`withdrawn` are terminal.
  4. THAT EVERY WRITE PROVES TENANCY IN THE STATEMENT, not in a check-then-write
     that another request can slip between.

── WHY SO MUCH OF THIS ASSERTS ON THE SQL TEXT ──────────────────────────────

Because the suite has no database. `tests/conftest.py` hands every module a
MagicMock pool, and a mock pool echoes the fixture back: a test that stubbed the
pool and asserted "the foreign row was not written" would pass green against a
statement whose WHERE clause had been deleted. So the statements are asserted
directly — the tenant predicate is still written, every parameter is still cast,
every relation is still schema-qualified, and `notes` is still concatenated
rather than assigned. That is the half a mock can prove. The other half — the
arithmetic and the refusals — is proved by calling the functions.
"""
from __future__ import annotations

import inspect
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from routers import custody as custody_mod
from services.custody import dsc, notices, udin

UTC = timezone.utc

ORG = "00000000-0000-0000-0000-000000000001"
OTHER_ORG = "00000000-0000-0000-0000-0000000000ff"
CLIENT = "c0000000-0000-0000-0000-000000000001"
CERT = "d0000000-0000-0000-0000-000000000001"
ENTRY = "u0000000-0000-0000-0000-000000000001"
NOTICE = "n0000000-0000-0000-0000-000000000001"
TYPE_REF = "70000000-0000-0000-0000-000000000001"

TODAY = date(2026, 8, 21)
NOW = datetime(2026, 8, 21, 9, 30, tzinfo=UTC)

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"

CALLER = {
    "user_id": "user_admin001",
    "email": "admin@test.com",
    "name": "Test Admin",
    "full_name": "Test Admin",
    "role": "admin",
}


# ══════════════════════════════════════════════════════════════════════════════
#  A pool that answers by STATEMENT, and remembers what it was asked
# ══════════════════════════════════════════════════════════════════════════════

class Pool:
    """Answers `fetch`/`fetchrow` by matching a substring of the statement.

    Keyed on the statement rather than on call order, because several of these
    write paths read something first (a windows table, a notice type, the row
    being changed) and a positional queue would silently shift the moment one
    of those reads is added or removed — which is exactly the sort of test
    failure that gets "fixed" by reordering the fixture until it goes green.
    """

    def __init__(self):
        self.rules: list[tuple[str, object]] = []
        self.calls: list[tuple[str, tuple]] = []

    def when(self, needle: str, answer):
        self.rules.append((needle, answer))
        return self

    def _answer(self, sql: str, default):
        for needle, answer in self.rules:
            if needle in sql:
                return answer
        return default

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        answer = self._answer(sql, [])
        return answer if isinstance(answer, list) else [answer]

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        answer = self._answer(sql, None)
        if isinstance(answer, list):
            return answer[0] if answer else None
        return answer

    def args_for(self, needle: str) -> tuple:
        for sql, args in self.calls:
            if needle in sql:
                return args
        raise AssertionError(
            f"no statement containing {needle!r} was run; "
            f"ran {[s[:60] for s, _ in self.calls]}"
        )

    def ran(self, needle: str) -> bool:
        return any(needle in sql for sql, _ in self.calls)


def window_rows(generate_days: int = 60, revoke_hours: int = 48):
    """`staging.udin_window` as `_SELECT_WINDOWS` returns it. TWO ROWS LIVE."""
    return [
        {"window_key": "generate", "window_amount": generate_days,
         "window_unit": "days", "effective_from": date(2021, 9, 17),
         "effective_to": None},
        {"window_key": "revoke", "window_amount": revoke_hours,
         "window_unit": "hours", "effective_from": date(2023, 6, 23),
         "effective_to": None},
    ]


def dsc_written(**over):
    """One `staging.dsc_register` row as the write path's CTE returns it.

    `org_id` is present because `dsc._shape` reads it for the tenancy guard and
    RAISES when it disagrees; a fixture without it would turn every test here
    into a CrossOrgLeak rather than into an assertion about the write.
    """
    row = {
        "org_id": ORG,
        "client_id": CLIENT,
        "id": CERT,
        "client_name": "Sharma Textiles Pvt Ltd",
        "holder_name": "Anil Sharma",
        "holder_kind": "individual",
        "holder_designation": "Director",
        "holder_pan": None, "holder_din": None,
        "certificate_class": "class_3",
        "certificate_type": "signature",
        "issuing_authority": "emudhra",
        "serial_number": "7F 21 AA",
        "valid_from": date(2025, 3, 1),
        "valid_to": date(2027, 2, 28),
        "revoked_on": None,
        "custody_status": "with_firm",
        "custody_location": "Cabinet 2",
        "custody_holder_name": None,
        "custody_changed_on": TODAY,
        "token_kind": "usb_token",
        "token_serial": "TK-9",
        "registered_portals": ["mca"],
        "notes": None, "is_active": True,
        "created_at": None, "updated_at": None,
    }
    row.update(over)
    return row


def udin_written(**over):
    row = {
        "id": ENTRY,
        "client_name": "Sharma Textiles Pvt Ltd",
        "document_kind": "certificate",
        "document_title": "Net worth certificate",
        "document_ref": "NW/26/11",
        "financial_year": "2026-27",
        "signed_on": date(2026, 8, 1),
        "signed_by_member": "CA Anil Sharma",
        "signed_by_membership_no": "304576",
        "source_module": "",
        "notes": "",
        "status": "signed",
        "udin": "",
        "udin_generated_at": None,
        "revoked_at": None,
        "revocation_reason": "",
        "replaced_by_udin": "",
    }
    row.update(over)
    return row


def notice_written(**over):
    """One `staging.notice_register` row as `_SELECT_WRITTEN` returns it."""
    row = {
        "org_id": ORG,
        "reference_no": "ZA2708260001",
        "received_on": date(2026, 8, 1),
        "due_on": date(2026, 8, 31),
        "due_date_from_notice": False,
        "window_in_working_days": False,
        "status": "open",
        "replied_on": None,
        "notes": "",
        "client_name": "Sharma Textiles Pvt Ltd",
        "notice_type": "gst_asmt_10",
        "notice_type_label": "GST ASMT-10 — scrutiny of returns",
        "authority": "gst",
        "form_no": "ASMT-10",
        "reply_form_no": "ASMT-11",
        "statute_ref": "", "statute_key": "",
        "window_basis": "statutory_max",
        "consequence": "s.73/74 determination",
        "source_url": "",
        "owner_name": None,
    }
    row.update(over)
    return row


def notice_state(**over):
    """What `_FETCH_NOTICE` returns — the state, before the change."""
    row = {
        "org_id": ORG,
        "reference_no": "ZA2708260001",
        "received_on": date(2026, 8, 1),
        "due_on": date(2026, 8, 31),
        "status": "open",
        "replied_on": None,
        "closed_on": None,
    }
    row.update(over)
    return row


def notice_type_row(**over):
    """What `_FETCH_TYPE` returns. `org_id` NULL is a SYSTEM type."""
    row = {
        "org_id": None,
        "notice_type_ref": TYPE_REF,
        "code": "gst_asmt_10",
        "label": "GST ASMT-10 — scrutiny of returns",
        "authority": "gst",
        "form_no": "ASMT-10",
        "reply_form_no": "ASMT-11",
        "statute_ref": "rule 99(1)",
        "window_basis": "statutory_max",
        "reply_window_days": 30,
        "reply_window_months": 0,
        "window_in_working_days": False,
        "consequence": "s.73/74 determination",
    }
    row.update(over)
    return row


# ══════════════════════════════════════════════════════════════════════════════
#  1 · DSC — the five statuses, and which of them a person may set
# ══════════════════════════════════════════════════════════════════════════════

class TestTheDerivedStatuses:
    """NONE OF THE FIVE IS SETTABLE. Two of them have a lever; three do not.

    `usable`, `expired` and `not_yet_valid` are arithmetic on the two validity
    dates and there is nothing to set at all. `revoked` and `not_in_possession`
    are derived from a fact a person genuinely records — a revocation date, a
    custody move — so the FACT is recordable and the STATUS is not, and the
    refusal has to say which of the two calls to make instead. A bare "status is
    not settable" leaves somebody who wanted to record a revocation with
    nowhere to go, which is how a field like this gets added back.
    """

    def test_the_refused_set_is_exactly_what_status_of_can_return(self):
        # Read off `status_of`'s own constants rather than restated, so a sixth
        # status added to the module cannot be silently settable.
        assert set(dsc.DERIVED_STATUSES) == {
            dsc.USABLE, dsc.NOT_IN_POSSESSION, dsc.NOT_YET_VALID,
            dsc.EXPIRED, dsc.REVOKED,
        }
        assert set(dsc._STATUS_LEVER) == set(dsc.DERIVED_STATUSES)

    @pytest.mark.parametrize("status", list(dsc.DERIVED_STATUSES))
    def test_every_one_of_them_is_refused(self, status):
        with pytest.raises(dsc.CustodyError) as exc:
            dsc.refuse_derived_status(status)
        assert "cannot be set" in str(exc.value)

    def test_the_two_with_a_lever_name_the_call_to_make_instead(self):
        with pytest.raises(dsc.CustodyError) as revoked:
            dsc.refuse_derived_status(dsc.REVOKED)
        assert "record_revocation" in str(revoked.value)

        with pytest.raises(dsc.CustodyError) as gone:
            dsc.refuse_derived_status(dsc.NOT_IN_POSSESSION)
        assert "record_custody_move" in str(gone.value)

    def test_the_three_without_one_explain_why_there_is_nothing_to_set(self):
        for status, needle in (
            (dsc.USABLE, "residual"),
            (dsc.EXPIRED, "valid_to"),
            (dsc.NOT_YET_VALID, "valid_from"),
        ):
            with pytest.raises(dsc.CustodyError) as exc:
                dsc.refuse_derived_status(status)
            assert needle in str(exc.value)
            # And none of the three points at a call that would not help.
            assert "record_revocation" not in str(exc.value)

    def test_a_word_that_is_not_a_status_at_all_says_so(self):
        with pytest.raises(dsc.CustodyError) as exc:
            dsc.refuse_derived_status("active")
        assert "not a certificate status" in str(exc.value)

    def test_absent_and_blank_are_silent(self):
        dsc.refuse_derived_status(None)
        dsc.refuse_derived_status("")
        dsc.refuse_derived_status("   ")


class TestRecordingACertificate:

    async def test_it_returns_the_row_with_the_status_its_own_write_produced(self):
        """A certificate recorded as `with_client` reads back as unusable
        immediately, rather than looking fine until the next refresh."""
        pool = Pool().when(
            "INSERT INTO public.dsc_register",
            dsc_written(custody_status="with_client", custody_location=None),
        )
        row = await dsc.record_certificate(
            pool, ORG, as_of=TODAY,
            holder_name="Anil Sharma",
            valid_from="2025-03-01", valid_to="2027-02-28",
            client_id=CLIENT, custody_status="with_client",
        )
        assert row["status"] == dsc.NOT_IN_POSSESSION
        assert "org_id" not in row and "client_id" not in row
        assert row["client_name"] == "Sharma Textiles Pvt Ltd"

    async def test_the_org_is_the_first_bound_argument(self):
        pool = Pool().when("INSERT INTO public.dsc_register", dsc_written())
        await dsc.record_certificate(
            pool, ORG, as_of=TODAY, holder_name="A",
            valid_from=date(2025, 3, 1), valid_to=date(2027, 2, 28),
        )
        args = pool.args_for("INSERT INTO public.dsc_register")
        assert args[0] == ORG

    async def test_an_absent_client_is_bound_as_null_and_not_as_a_blank(self):
        """`''` reaching a `::uuid` cast is an instant PgBouncer 500. An empty
        form field is exactly how one gets there."""
        pool = Pool().when("INSERT INTO public.dsc_register",
                           dsc_written(client_id=None, client_name=None))
        row = await dsc.record_certificate(
            pool, ORG, as_of=TODAY, holder_name="A", client_id="",
            valid_from=date(2025, 3, 1), valid_to=date(2027, 2, 28),
        )
        assert pool.args_for("INSERT INTO public.dsc_register")[1] is None
        # NULL client means the PRACTICE'S OWN certificate, not "any client".
        assert row["belongs_to_firm"] is True

    async def test_a_client_that_is_not_this_orgs_is_a_refusal_not_a_row(self):
        # The statement's WHERE finds no client and inserts nothing. None is a
        # refusal and must never be read as "already recorded".
        pool = Pool()
        assert await dsc.record_certificate(
            pool, ORG, as_of=TODAY, holder_name="A", client_id=CLIENT,
            valid_from=date(2025, 3, 1), valid_to=date(2027, 2, 28),
        ) is None

    async def test_transposed_dates_are_refused_before_the_check_constraint(self):
        with pytest.raises(dsc.CustodyError) as exc:
            await dsc.record_certificate(
                Pool(), ORG, as_of=TODAY, holder_name="A",
                valid_from=date(2027, 2, 28), valid_to=date(2025, 3, 1),
            )
        assert "transposed" in str(exc.value)

    async def test_a_one_day_certificate_is_legitimate(self):
        """A re-issue on the day of expiry. The comparison is `<`, not `<=`."""
        pool = Pool().when("INSERT INTO public.dsc_register", dsc_written())
        assert await dsc.record_certificate(
            pool, ORG, as_of=TODAY, holder_name="A",
            valid_from=date(2026, 8, 21), valid_to=date(2026, 8, 21),
        ) is not None

    async def test_a_blank_holder_is_refused(self):
        for blank in ("", "   ", None):
            with pytest.raises(dsc.CustodyError):
                await dsc.record_certificate(
                    Pool(), ORG, as_of=TODAY, holder_name=blank,
                    valid_from=date(2025, 3, 1), valid_to=date(2027, 2, 28),
                )

    async def test_a_value_outside_a_check_vocabulary_is_refused_in_words(self):
        with pytest.raises(dsc.CustodyError) as exc:
            await dsc.record_certificate(
                Pool(), ORG, as_of=TODAY, holder_name="A",
                valid_from=date(2025, 3, 1), valid_to=date(2027, 2, 28),
                custody_status="in_the_post",
            )
        # The whole vocabulary, so the caller can see what it may say.
        assert "with_client" in str(exc.value)

    async def test_a_certificate_is_never_born_revoked(self):
        with pytest.raises(dsc.CustodyError) as exc:
            await dsc.record_certificate(
                Pool(), ORG, as_of=TODAY, holder_name="A",
                valid_from=date(2025, 3, 1), valid_to=date(2027, 2, 28),
                revoked_on=date(2026, 1, 1),
            )
        assert "record_revocation" in str(exc.value)

    async def test_an_implausible_span_is_a_warning_and_not_a_refusal(self):
        """GSTIN, PAN and TAN block nothing in this product and a validity span
        is held to the same standard. A rejection here gets worked around by
        typing a date that is wrong in a way nothing notices."""
        pool = Pool().when(
            "INSERT INTO public.dsc_register",
            dsc_written(valid_from=date(2025, 3, 1), valid_to=date(2037, 3, 1),
                        serial_number=None),
        )
        row = await dsc.record_certificate(
            pool, ORG, as_of=TODAY, holder_name="A",
            valid_from=date(2025, 3, 1), valid_to=date(2037, 3, 1),
            issuing_authority="Some CA Nobody Has Heard Of",
        )
        assert row is not None
        assert any("check the year" in w for w in row["warnings"])
        assert any("serial" in w for w in row["warnings"])

    async def test_custody_changed_on_defaults_to_the_write_date(self):
        pool = Pool().when("INSERT INTO public.dsc_register", dsc_written())
        await dsc.record_certificate(
            pool, ORG, as_of=TODAY, holder_name="A", custody_status="with_client",
            valid_from=date(2025, 3, 1), valid_to=date(2027, 2, 28),
        )
        # Without a date, `with_client` is undated and nobody can tell a token
        # returned last week from one returned in 2023.
        assert pool.args_for("INSERT INTO public.dsc_register")[16] == TODAY

    async def test_portals_are_deduplicated_and_folded(self):
        pool = Pool().when("INSERT INTO public.dsc_register", dsc_written())
        await dsc.record_certificate(
            pool, ORG, as_of=TODAY, holder_name="A",
            valid_from=date(2025, 3, 1), valid_to=date(2027, 2, 28),
            registered_portals=["MCA", "mca", " incometax "],
        )
        assert pool.args_for("INSERT INTO public.dsc_register")[19] == [
            "mca", "incometax"
        ]


class TestRevokingACertificate:

    def _pool(self, existing=None, written=None):
        # THE WRITE RULE COMES FIRST. `_UPDATE_REVOCATION` ends with the same
        # projection `_FETCH_ONE` opens with, so a needle matched against the
        # SELECT list would answer the UPDATE with the row as it stood BEFORE
        # the write — which reads exactly like "the revocation did nothing".
        return (
            Pool()
            .when("SET revoked_on",
                  written if written is not None else
                  dsc_written(revoked_on=date(2026, 6, 1)))
            .when("FROM public.dsc_register d",
                  existing if existing is not None else dsc_written())
        )

    async def test_it_records_the_date_and_the_status_follows(self):
        pool = self._pool()
        row = await dsc.record_revocation(
            pool, ORG, CERT, as_of=TODAY, revoked_on="2026-06-01",
            reason="Holder left the company",
        )
        assert row["status"] == dsc.REVOKED
        assert pool.args_for("SET revoked_on")[2] == date(2026, 6, 1)

    async def test_the_reason_is_appended_as_a_dated_line(self):
        pool = self._pool()
        await dsc.record_revocation(
            pool, ORG, CERT, as_of=TODAY, revoked_on=date(2026, 6, 1),
            reason="Holder left the company",
        )
        line = pool.args_for("SET revoked_on")[3]
        assert line.startswith(f"[{TODAY.isoformat()}] Revoked: ")
        assert "Holder left the company" in line

    async def test_no_reason_binds_the_empty_string_so_notes_are_left_alone(self):
        pool = self._pool()
        await dsc.record_revocation(
            pool, ORG, CERT, as_of=TODAY, revoked_on=date(2026, 6, 1),
        )
        assert pool.args_for("SET revoked_on")[3] == ""

    async def test_an_already_revoked_certificate_is_refused_with_its_own_date(self):
        """A second revocation date would replace the first and leave the
        register with an answer and no way to say which of the two it is."""
        pool = self._pool(existing=dsc_written(revoked_on=date(2026, 3, 12)))
        with pytest.raises(dsc.CustodyError) as exc:
            await dsc.record_revocation(
                pool, ORG, CERT, as_of=TODAY, revoked_on=date(2026, 6, 1),
            )
        assert "2026-03-12" in str(exc.value)
        assert not pool.ran("SET revoked_on")

    async def test_a_revocation_before_issue_is_refused(self):
        pool = self._pool()
        with pytest.raises(dsc.CustodyError) as exc:
            await dsc.record_revocation(
                pool, ORG, CERT, as_of=TODAY, revoked_on=date(2024, 1, 1),
            )
        assert "precedes" in str(exc.value)

    async def test_a_future_revocation_is_allowed_and_flagged(self):
        """A scheduled surrender is a real thing a practice arranges. It is rare
        enough that seeing it stated is worth more than the noise."""
        ahead = TODAY + timedelta(days=30)
        pool = self._pool(written=dsc_written(revoked_on=ahead))
        row = await dsc.record_revocation(
            pool, ORG, CERT, as_of=TODAY, revoked_on=ahead,
        )
        assert any("future" in w for w in row["warnings"])
        # Not yet dead ON as_of, so the status is not `revoked` today.
        assert row["status"] != dsc.REVOKED

    async def test_a_certificate_from_another_org_is_a_refusal(self):
        assert await dsc.record_revocation(
            Pool(), ORG, CERT, as_of=TODAY, revoked_on=date(2026, 6, 1),
        ) is None

    async def test_a_foreign_row_coming_back_raises_rather_than_being_used(self):
        pool = self._pool(existing=dsc_written(org_id=OTHER_ORG))
        with pytest.raises(dsc.CrossOrgLeak):
            await dsc.record_revocation(
                pool, ORG, CERT, as_of=TODAY, revoked_on=date(2026, 6, 1),
            )


class TestMovingCustody:

    async def test_it_records_where_the_token_went(self):
        pool = Pool().when(
            "SET custody_status",
            dsc_written(custody_status="with_client", custody_location=None,
                        custody_holder_name="Anil Sharma"),
        )
        row = await dsc.record_custody_move(
            pool, ORG, CERT, as_of=TODAY, custody_status="with_client",
            custody_holder_name="Anil Sharma", note="Collected from reception",
        )
        assert row["status"] == dsc.NOT_IN_POSSESSION
        assert row["custody_status"] == "with_client"

    async def test_a_move_dated_tomorrow_is_refused(self):
        with pytest.raises(dsc.CustodyError) as exc:
            await dsc.record_custody_move(
                Pool(), ORG, CERT, as_of=TODAY, custody_status="with_client",
                changed_on=TODAY + timedelta(days=1),
            )
        assert "future" in str(exc.value)

    async def test_the_state_is_required_and_the_vocabulary_is_the_migrations(self):
        with pytest.raises(dsc.CustodyError):
            await dsc.record_custody_move(
                Pool(), ORG, CERT, as_of=TODAY, custody_status="",
            )
        with pytest.raises(dsc.CustodyError):
            await dsc.record_custody_move(
                Pool(), ORG, CERT, as_of=TODAY, custody_status="somewhere",
            )

    async def test_a_lost_token_still_reports_the_security_warning(self):
        pool = Pool().when("SET custody_status",
                           dsc_written(custody_status="lost"))
        row = await dsc.record_custody_move(
            pool, ORG, CERT, as_of=TODAY, custody_status="lost",
        )
        assert any("lost" in w for w in row["warnings"])

    async def test_the_note_is_dated_and_names_the_new_state(self):
        pool = Pool().when("SET custody_status",
                           dsc_written(custody_status="in_transit"))
        await dsc.record_custody_move(
            pool, ORG, CERT, as_of=TODAY, custody_status="in_transit",
            note="Couriered to Nashik",
        )
        line = pool.args_for("SET custody_status")[6]
        assert "in_transit" in line and "Couriered to Nashik" in line


# ══════════════════════════════════════════════════════════════════════════════
#  2 · UDIN — the two windows, on the write path
# ══════════════════════════════════════════════════════════════════════════════

class TestRecordingASigning:

    async def test_a_ninety_day_old_signing_is_recorded_not_refused(self):
        """THE WINDOW IS NOT CHECKED ON CREATE and must not be. A document
        signed ninety days ago with no UDIN is exactly what the at-risk list and
        the `lapsed` count exist to show, and a firm typing up its backlog is
        entering precisely those. Refusing them makes the unfixable part of the
        exposure invisible."""
        old = TODAY - timedelta(days=90)
        pool = (Pool()
                .when("public.udin_window", window_rows())
                .when("INSERT INTO public.udin_register",
                      udin_written(signed_on=old)))
        row = await udin.record_signing(
            pool, ORG, now=NOW, document_kind="certificate",
            document_title="Net worth certificate", signed_on=old,
            signed_by_member="CA Anil Sharma", client_name="Sharma Textiles",
        )
        assert row["is_lapsed"] is True
        assert row["urgency"] == "lapsed"
        assert row["status"] == "signed"

    async def test_a_signing_dated_tomorrow_is_refused(self):
        pool = Pool().when("public.udin_window", window_rows())
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_signing(
                pool, ORG, now=NOW, document_kind="certificate",
                document_title="X", signed_on=TODAY + timedelta(days=1),
                signed_by_member="CA A", client_name="Y",
            )
        assert "future" in str(exc.value)

    async def test_the_row_is_born_unnumbered_and_says_so_if_asked_otherwise(self):
        pool = Pool().when("public.udin_window", window_rows())
        for kwargs in ({"status": "generated"}, {"udin": "26304576AKTSBN1359"}):
            with pytest.raises(udin.UdinError):
                await udin.record_signing(
                    pool, ORG, now=NOW, document_kind="certificate",
                    document_title="X", signed_on=TODAY,
                    signed_by_member="CA A", client_name="Y", **kwargs,
                )
        # 'signed' is a literal in the statement, not a parameter.
        assert "'signed'" in udin._INSERT_SIGNING

    async def test_neither_a_name_nor_a_client_is_refused(self):
        pool = Pool().when("public.udin_window", window_rows())
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_signing(
                pool, ORG, now=NOW, document_kind="certificate",
                document_title="X", signed_on=TODAY, signed_by_member="CA A",
            )
        assert "client_name" in str(exc.value)

    async def test_a_client_with_no_name_takes_the_snapshot_from_the_company_row(self):
        # In the statement, not in a second round trip — so the snapshot and the
        # tenancy proof are the same read.
        assert "COALESCE(NULLIF(btrim($3::text), '')" in udin._INSERT_SIGNING
        assert "public.graha_clients c" in udin._INSERT_SIGNING

    async def test_an_unknown_document_kind_lists_icais_three(self):
        pool = Pool().when("public.udin_window", window_rows())
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_signing(
                pool, ORG, now=NOW, document_kind="tax_return",
                document_title="X", signed_on=TODAY,
                signed_by_member="CA A", client_name="Y",
            )
        assert "gst_or_tax_audit_report" in str(exc.value)

    async def test_a_wrong_looking_financial_year_is_refused_in_words(self):
        pool = Pool().when("public.udin_window", window_rows())
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_signing(
                pool, ORG, now=NOW, document_kind="certificate",
                document_title="X", signed_on=TODAY, signed_by_member="CA A",
                client_name="Y", financial_year="2026-2027",
            )
        assert "2026-27" in str(exc.value)


class TestTheSixtyDayWindowOnWrite:
    """The one genuinely statutory refusal in the package.

    Past the window the ICAI portal itself will not issue a number, so a
    register that accepted one would be recording something that did not
    happen — and the row would leave the `lapsed` count, which is the only
    figure here representing something already unfixable.
    """

    def _pool(self, *, generate_days=60, signed_on, status="signed",
              written=None):
        return (Pool()
                .when("public.udin_window", window_rows(generate_days))
                .when("FROM public.udin_register \n WHERE org_id" if False else
                      "SELECT id, client_name, document_kind, document_title, "
                      "document_ref,        financial_year",
                      udin_written(signed_on=signed_on, status=status))
                .when("SET status = 'generated'",
                      written if written is not None else
                      udin_written(signed_on=signed_on, status="generated",
                                   udin="26304576AKTSBN1359",
                                   udin_generated_at=NOW)))

    async def test_the_last_day_of_the_window_still_works(self):
        """`days_left == 0` means TODAY IS THE LAST DAY and is NOT lapsed. Sixty
        days from the 1st ends on `signed_on + 59` — FAQ Q19 counts both end
        dates — and writing the obvious `+ 60` hands a firm a day it does not
        have, on the day somebody is finally looking."""
        signed = TODAY - timedelta(days=59)
        pool = self._pool(signed_on=signed)
        row = await udin.record_generation(
            pool, ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
        )
        assert row["status"] == "generated"

    async def test_one_day_past_the_window_is_refused(self):
        signed = TODAY - timedelta(days=60)
        pool = self._pool(signed_on=signed)
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_generation(
                pool, ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
            )
        message = str(exc.value)
        assert "60-day window" in message
        assert (signed + timedelta(days=59)).isoformat() in message
        assert "lapsed count" in message
        assert not pool.ran("SET status = 'generated'")

    async def test_the_window_comes_from_the_table_and_not_from_the_constant(self):
        """The generation window has already moved once — 15 days to 60, at the
        Council's 405th meeting on 17 September 2021 — so the next Council
        decision must be an INSERT rather than a deploy."""
        signed = TODAY - timedelta(days=40)
        # 60 days: comfortably inside. 30 days: closed ten days ago.
        assert await udin.record_generation(
            self._pool(generate_days=60, signed_on=signed),
            ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
        ) is not None
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_generation(
                self._pool(generate_days=30, signed_on=signed),
                ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
            )
        assert "30-day window" in str(exc.value)

    async def test_now_is_the_ceiling_on_a_supplied_generation_instant(self):
        """A caller-supplied instant that could run ahead of the server would
        hand somebody a 48-hour revocation window they do not have."""
        pool = self._pool(signed_on=TODAY - timedelta(days=5))
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_generation(
                pool, ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
                generated_at=NOW + timedelta(minutes=1),
            )
        assert "future" in str(exc.value)

    async def test_a_past_instant_is_accepted_and_only_shortens_the_window(self):
        signed = TODAY - timedelta(days=5)
        earlier = NOW - timedelta(hours=40)
        pool = self._pool(
            signed_on=signed,
            written=udin_written(signed_on=signed, status="generated",
                                 udin="26304576AKTSBN1359",
                                 udin_generated_at=earlier),
        )
        row = await udin.record_generation(
            pool, ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
            generated_at=earlier,
        )
        assert pool.args_for("SET status = 'generated'")[3] == earlier
        # 48 - 40 = 8 hours left, not 48.
        assert 0 < row["revocation"]["seconds_left"] <= 8 * 3600

    async def test_an_instant_before_the_signing_is_refused(self):
        signed = TODAY - timedelta(days=5)
        pool = self._pool(signed_on=signed)
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_generation(
                pool, ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
                generated_at=NOW - timedelta(days=10),
            )
        assert "precedes the signing" in str(exc.value)

    async def test_a_row_that_already_carries_a_number_is_refused(self):
        pool = self._pool(signed_on=TODAY - timedelta(days=5),
                          status="generated")
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_generation(
                pool, ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
            )
        assert "already carries a UDIN" in str(exc.value)

    async def test_a_revoked_row_points_at_a_fresh_signing(self):
        pool = self._pool(signed_on=TODAY - timedelta(days=5), status="revoked")
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_generation(
                pool, ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
            )
        assert "Q124" in str(exc.value)


class TestTheUdinStringOnWrite:

    def test_the_column_bar_is_enforced_and_the_syntax_is_not(self):
        # 18 alphanumerics is `udin_register_udin_shape_ck`, and a
        # CheckViolation is a 500 with nothing readable in it.
        with pytest.raises(udin.UdinError) as exc:
            udin._clean_udin("TOO-SHORT")
        assert "18 letters or digits" in str(exc.value)
        # But NOT the internal shape. This is 18 alphanumerics and matches
        # nothing ICAI publishes; it is stored as entered.
        assert udin._clean_udin("zzzzzzzzzzzzzzzzzz") == "ZZZZZZZZZZZZZZZZZZ"
        assert udin.udin_syntax("ZZZZZZZZZZZZZZZZZZ")["notes"]

    def test_it_is_upper_cased_because_the_unique_index_is_on_the_raw_text(self):
        """`uq_udin_register_udin` is (org_id, udin). 'abc…' and 'ABC…' would be
        two rows, and one document would look numbered twice. A UDIN's
        alphabetic part is upper-case by construction, so folding destroys
        nothing a real number carries."""
        assert udin._clean_udin(" 26304576aktsbn1359 ") == "26304576AKTSBN1359"

    async def test_a_duplicate_number_comes_back_as_a_sentence_not_a_500(self):
        import asyncpg

        class Duplicating(Pool):
            async def fetchrow(self, sql, *args):
                if "SET status = 'generated'" in sql:
                    raise asyncpg.UniqueViolationError("duplicate key")
                return await super().fetchrow(sql, *args)

        signed = TODAY - timedelta(days=5)
        pool = (Duplicating()
                .when("public.udin_window", window_rows())
                .when("SELECT id, client_name, document_kind",
                      udin_written(signed_on=signed)))
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_generation(
                pool, ORG, ENTRY, udin="26304576AKTSBN1359", now=NOW,
            )
        assert "already recorded against another document" in str(exc.value)


class TestTheFortyEightHourWindowOnWrite:

    def _pool(self, *, generated_at, revoke_hours=48, status="generated"):
        return (Pool()
                .when("public.udin_window", window_rows(60, revoke_hours))
                .when("SELECT id, client_name, document_kind",
                      udin_written(status=status, udin="26304576AKTSBN1359",
                                   udin_generated_at=generated_at))
                .when("SET status = 'revoked'",
                      udin_written(status="revoked",
                                   udin="26304576AKTSBN1359",
                                   udin_generated_at=generated_at,
                                   revoked_at=NOW,
                                   revocation_reason="Wrong figure")))

    async def test_one_second_inside_the_window_still_revokes(self):
        pool = self._pool(generated_at=NOW - timedelta(hours=48, seconds=-1))
        row = await udin.record_revocation(
            pool, ORG, ENTRY, reason="Wrong figure", now=NOW,
        )
        assert row["status"] == "revoked"
        assert pool.args_for("SET status = 'revoked'")[2] == NOW

    async def test_exactly_forty_eight_hours_is_already_too_late(self):
        """"Within 48 hours from the time of its generation" EXCLUDES the
        instant 48 hours later — at exactly +48:00:00 the portal already answers
        that the UDIN can no longer be revoked (FAQ Q125)."""
        pool = self._pool(generated_at=NOW - timedelta(hours=48))
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_revocation(
                pool, ORG, ENTRY, reason="Wrong figure", now=NOW,
            )
        assert "Q124" in str(exc.value)
        assert not pool.ran("SET status = 'revoked'")

    async def test_the_revoke_window_comes_from_the_table_too(self):
        generated = NOW - timedelta(hours=3)
        assert await udin.record_revocation(
            self._pool(generated_at=generated, revoke_hours=48),
            ORG, ENTRY, reason="Wrong figure", now=NOW,
        ) is not None
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_revocation(
                self._pool(generated_at=generated, revoke_hours=2),
                ORG, ENTRY, reason="Wrong figure", now=NOW,
            )
        assert "2-hour revocation window" in str(exc.value)

    async def test_a_revocation_needs_a_reason(self):
        pool = self._pool(generated_at=NOW - timedelta(hours=1))
        for blank in ("", "   ", None):
            with pytest.raises(udin.UdinError):
                await udin.record_revocation(
                    pool, ORG, ENTRY, reason=blank, now=NOW,
                )

    async def test_a_signed_row_has_nothing_to_revoke(self):
        pool = self._pool(generated_at=None, status="signed")
        with pytest.raises(udin.UdinError) as exc:
            await udin.record_revocation(
                pool, ORG, ENTRY, reason="Wrong figure", now=NOW,
            )
        assert "no UDIN yet" in str(exc.value)

    async def test_a_replacement_number_is_held_to_the_column_bar(self):
        pool = self._pool(generated_at=NOW - timedelta(hours=1))
        with pytest.raises(udin.UdinError):
            await udin.record_revocation(
                pool, ORG, ENTRY, reason="Wrong figure", now=NOW,
                replaced_by_udin="nope",
            )


class TestMarkingNotRequired:

    def _pool(self, status="signed"):
        return (Pool()
                .when("public.udin_window", window_rows())
                .when("SELECT id, client_name, document_kind",
                      udin_written(status=status))
                .when("SET status = 'not_required'",
                      udin_written(status="not_required")))

    async def test_it_is_the_honest_way_off_the_backlog(self):
        """Without it the only exits from the at-risk list are a real number and
        a lapse, so a document that never carried the duty would nag for ever —
        and a compliance list that nags about things nobody can fix is a list
        people stop reading."""
        pool = self._pool()
        row = await udin.mark_not_required(
            pool, ORG, ENTRY, reason="Not an attestation function", now=NOW,
        )
        assert row["status"] == "not_required"

    async def test_it_needs_a_reason_because_it_is_a_judgement(self):
        with pytest.raises(udin.UdinError):
            await udin.mark_not_required(self._pool(), ORG, ENTRY,
                                         reason="  ", now=NOW)

    async def test_a_numbered_document_cannot_become_not_required(self):
        with pytest.raises(udin.UdinError) as exc:
            await udin.mark_not_required(self._pool("generated"), ORG, ENTRY,
                                         reason="Mistake", now=NOW)
        assert "already carries a UDIN" in str(exc.value)


# ══════════════════════════════════════════════════════════════════════════════
#  3 · NOTICES — a log does not overwrite
# ══════════════════════════════════════════════════════════════════════════════

class TestRecordingANotice:

    def _pool(self, *, kind=None, written=None):
        # The INSERT reads `staging.notice_type t` too — that is where the
        # window snapshot comes from — so the catalogue rule is matched on the
        # predicate only `_FETCH_TYPE` carries, and the write rule goes first.
        return (Pool()
                .when("INSERT INTO public.notice_register",
                      [written if written is not None else notice_written()])
                .when("t.code = $2::text",
                      kind if kind is not None else notice_type_row()))

    async def test_it_files_the_notice_and_bands_it(self):
        pool = self._pool()
        row = await notices.record_notice(
            pool, ORG, as_of=TODAY, client_id=CLIENT,
            notice_type_code="gst_asmt_10", reference_no="ZA2708260001",
            received_on=date(2026, 8, 1),
        )
        assert row["urgency"].band == notices.SOON
        assert row["due_on_predicted"] == date(2026, 8, 31)
        assert "org_id" not in row

    async def test_the_window_is_snapshotted_from_the_catalogue_in_sql(self):
        """Migration 162 stores the window ON THE ROW precisely so a later edit
        to the catalogue cannot move the due date of a notice filed last year —
        `due_on` is a STORED GENERATED column computed from it. So the window is
        never a parameter, and it is taken from `t` inside the statement."""
        statement = notices._INSERT_NOTICE
        for column in ("t.reply_window_days", "t.reply_window_months",
                       "t.window_in_working_days"):
            assert column in statement, column
        # And no caller can supply one.
        params = inspect.signature(notices.record_notice).parameters
        assert not any("window" in p for p in params)

    async def test_a_type_whose_period_the_notice_sets_needs_a_date_off_it(self):
        """rule 142 prescribes no reply period for a DRC-01. Without an override
        the row would compute `received_on + 0` and read as due the day it
        arrived, then overdue every day after, for ever."""
        pool = self._pool(kind=notice_type_row(
            code="gst_drc_01", window_basis="notice_specified",
            reply_window_days=0, reply_window_months=0, form_no="DRC-01",
        ))
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_notice(
                pool, ORG, as_of=TODAY, client_id=CLIENT,
                notice_type_code="gst_drc_01", reference_no="X",
                received_on=date(2026, 8, 1),
            )
        assert "read off the notice" in str(exc.value)
        assert not pool.ran("INSERT INTO public.notice_register")

    async def test_the_officers_own_date_beats_the_statutory_default(self):
        """An ASMT-10 that says fifteen days is due in fifteen even though rule
        99(1) caps the officer at thirty."""
        pool = self._pool(written=notice_written(
            due_on=date(2026, 8, 16), due_date_from_notice=True))
        row = await notices.record_notice(
            pool, ORG, as_of=TODAY, client_id=CLIENT,
            notice_type_code="gst_asmt_10", reference_no="ZA1",
            received_on=date(2026, 8, 1), due_on_override=date(2026, 8, 16),
        )
        assert row["due_on_predicted"] == date(2026, 8, 16)
        assert row["due_date_from_notice"] is True

    async def test_a_notice_served_tomorrow_is_refused(self):
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_notice(
                self._pool(), ORG, as_of=TODAY, client_id=CLIENT,
                notice_type_code="gst_asmt_10", reference_no="X",
                received_on=TODAY + timedelta(days=1),
            )
        assert "future" in str(exc.value)

    async def test_a_date_before_gst_existed_is_refused(self):
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_notice(
                self._pool(), ORG, as_of=TODAY, client_id=CLIENT,
                notice_type_code="gst_asmt_10", reference_no="X",
                received_on=date(1926, 8, 1),
            )
        assert "2017-07-01" in str(exc.value)

    async def test_a_deadline_before_the_notice_arrived_is_refused(self):
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_notice(
                self._pool(), ORG, as_of=TODAY, client_id=CLIENT,
                notice_type_code="gst_asmt_10", reference_no="X",
                received_on=date(2026, 8, 10),
                due_on_override=date(2026, 8, 1),
            )
        assert "dd/mm" in str(exc.value) or "precedes" in str(exc.value)

    async def test_an_unknown_code_is_refused_before_anything_is_written(self):
        pool = Pool()
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_notice(
                pool, ORG, as_of=TODAY, client_id=CLIENT,
                notice_type_code="not_a_form", reference_no="X",
                received_on=date(2026, 8, 1),
            )
        assert "catalogue" in str(exc.value)
        assert not pool.ran("INSERT INTO public.notice_register")

    async def test_a_client_or_type_from_another_practice_is_a_refusal(self):
        pool = (Pool().when("INSERT INTO public.notice_register", [])
                      .when("t.code = $2::text", notice_type_row()))
        assert await notices.record_notice(
            pool, ORG, as_of=TODAY, client_id=CLIENT,
            notice_type_code="gst_asmt_10", reference_no="X",
            received_on=date(2026, 8, 1),
        ) is None

    async def test_a_duplicate_reference_is_a_sentence_not_a_500(self):
        import asyncpg

        class Duplicating(Pool):
            async def fetch(self, sql, *args):
                if "INSERT INTO public.notice_register" in sql:
                    raise asyncpg.UniqueViolationError("duplicate key")
                return await super().fetch(sql, *args)

        pool = Duplicating().when("t.code = $2::text", notice_type_row())
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_notice(
                pool, ORG, as_of=TODAY, client_id=CLIENT,
                notice_type_code="gst_asmt_10", reference_no="ZA1",
                received_on=date(2026, 8, 1),
            )
        assert "two clocks on one notice" in str(exc.value)

    async def test_a_practices_own_type_wins_over_a_system_one(self):
        """`uq_notice_type_code` is UNIQUE NULLS NOT DISTINCT on (org_id, code),
        so both rows are visible. Without the ordering AND the limit, an
        INSERT … SELECT over them would write TWO register rows for one notice."""
        statement = notices._FETCH_TYPE
        assert "ORDER BY t.org_id NULLS LAST" in statement
        assert "LIMIT 1" in statement

    async def test_another_practices_private_type_raises_rather_than_filtering(self):
        pool = self._pool(kind=notice_type_row(org_id=OTHER_ORG))
        with pytest.raises(notices.CrossOrgLeak):
            await notices.notice_type_for(pool, ORG, "gst_asmt_10")

    async def test_an_unassigned_notice_is_allowed(self):
        """NULL owner is a real and dangerous state that migration 162 makes
        representable on purpose. Refusing to record a notice until somebody
        owns it means the notice does not get recorded."""
        pool = self._pool()
        row = await notices.record_notice(
            pool, ORG, as_of=TODAY, client_id=CLIENT,
            notice_type_code="gst_asmt_10", reference_no="ZA1",
            received_on=date(2026, 8, 1),
        )
        assert row["owner_name"] is None
        assert pool.args_for("INSERT INTO public.notice_register")[6] is False


class TestTheNoticeLifecycle:

    def _pool(self, *, state=None, written=None):
        return (Pool()
                .when("FROM public.notice_register r\n     WHERE r.org_id"
                      if False else "SELECT r.org_id,\n           "
                                    "r.reference_no,\n           "
                                    "r.received_on,\n           r.due_on,\n"
                                    "           r.status",
                      state if state is not None else notice_state())
                .when("SET status     =",
                      [written if written is not None
                       else notice_written(status="replied",
                                           replied_on=date(2026, 8, 20))]))

    async def test_a_reply_stops_the_clock(self):
        pool = self._pool()
        row = await notices.record_status_change(
            pool, ORG, NOTICE, as_of=TODAY, to_status="replied",
            on_date=date(2026, 8, 20), note="ASMT-11 filed",
        )
        assert row["urgency"].band == notices.STOPPED
        assert pool.args_for("SET status     =")[3] == date(2026, 8, 20)
        # closed_on stays unset.
        assert pool.args_for("SET status     =")[4] is None

    async def test_the_dated_line_is_written_even_with_no_note(self):
        pool = self._pool()
        await notices.record_status_change(
            pool, ORG, NOTICE, as_of=TODAY, to_status="replied",
            on_date=date(2026, 8, 20),
        )
        line = pool.args_for("SET status     =")[5]
        assert line == f"[{TODAY.isoformat()}] Reply filed on 2026-08-20"

    async def test_closed_and_withdrawn_are_terminal_and_say_what_to_do(self):
        for terminal in notices.TERMINAL_STATUSES:
            pool = self._pool(state=notice_state(status=terminal))
            with pytest.raises(notices.NoticeError) as exc:
                await notices.record_status_change(
                    pool, ORG, NOTICE, as_of=TODAY, to_status="replied",
                )
            assert "NEW notice" in str(exc.value)
            assert not pool.ran("SET status     =")

    async def test_a_reply_can_still_be_escalated(self):
        """A reply the officer rejects still ends in a determination, and a
        register that could not record that would show the practice as safe."""
        pool = self._pool(
            state=notice_state(status="replied", replied_on=date(2026, 8, 20)),
            written=notice_written(status="escalated"),
        )
        assert await notices.record_status_change(
            pool, ORG, NOTICE, as_of=TODAY, to_status="escalated",
        ) is not None

    async def test_an_escalated_notice_cannot_go_back_to_open(self):
        pool = self._pool(state=notice_state(status="escalated"))
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_status_change(
                pool, ORG, NOTICE, as_of=TODAY, to_status="open",
            )
        assert "cannot become" in str(exc.value)

    async def test_a_no_op_change_is_refused(self):
        pool = self._pool()
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_status_change(
                pool, ORG, NOTICE, as_of=TODAY, to_status="open",
            )
        assert "already recorded" in str(exc.value)

    async def test_a_reply_filed_tomorrow_is_refused(self):
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_status_change(
                self._pool(), ORG, NOTICE, as_of=TODAY, to_status="replied",
                on_date=TODAY + timedelta(days=1),
            )
        assert "future" in str(exc.value)

    async def test_a_reply_before_service_is_refused(self):
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_status_change(
                self._pool(), ORG, NOTICE, as_of=TODAY, to_status="replied",
                on_date=date(2026, 7, 1),
            )
        assert "before the notice was served" in str(exc.value)

    async def test_a_closure_before_the_recorded_reply_is_refused(self):
        pool = self._pool(
            state=notice_state(status="replied", replied_on=date(2026, 8, 20)))
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_status_change(
                pool, ORG, NOTICE, as_of=TODAY, to_status="closed",
                on_date=date(2026, 8, 10),
            )
        assert "precedes the reply" in str(exc.value)

    async def test_the_expected_status_is_bound_for_optimistic_concurrency(self):
        pool = self._pool()
        await notices.record_status_change(
            pool, ORG, NOTICE, as_of=TODAY, to_status="replied",
        )
        assert pool.args_for("SET status     =")[6] == "open"

    async def test_a_notice_from_another_practice_is_a_refusal(self):
        assert await notices.record_status_change(
            Pool(), ORG, NOTICE, as_of=TODAY, to_status="replied",
        ) is None

    async def test_a_foreign_row_raises_rather_than_being_changed(self):
        pool = self._pool(state=notice_state(org_id=OTHER_ORG))
        with pytest.raises(notices.CrossOrgLeak):
            await notices.record_status_change(
                pool, ORG, NOTICE, as_of=TODAY, to_status="replied",
            )
        assert not pool.ran("SET status     =")

    async def test_an_unknown_status_lists_the_five(self):
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_status_change(
                self._pool(), ORG, NOTICE, as_of=TODAY, to_status="done",
            )
        assert "withdrawn" in str(exc.value)


class TestChangingTheReplyDate:

    def _pool(self, *, state=None, written=None):
        return (Pool()
                .when("SELECT r.org_id,\n           r.reference_no,\n"
                      "           r.received_on,\n           r.due_on,\n"
                      "           r.status",
                      state if state is not None else notice_state())
                .when("SET due_on_override",
                      [written if written is not None
                       else notice_written(due_on=date(2026, 9, 15),
                                           due_date_from_notice=True)]))

    async def test_the_previous_date_is_written_into_the_notes(self):
        """A statutory correspondence log that quietly restates a deadline is a
        log that cannot be used as evidence of anything."""
        pool = self._pool()
        await notices.record_due_date(
            pool, ORG, NOTICE, as_of=TODAY,
            due_on_override=date(2026, 9, 15), note="Extension granted",
        )
        line = pool.args_for("SET due_on_override")[3]
        assert "from 2026-08-31" in line and "to 2026-09-15" in line
        assert "Extension granted" in line

    async def test_only_a_live_notice_takes_one(self):
        for stopped in ("replied", "closed", "withdrawn"):
            pool = self._pool(state=notice_state(status=stopped))
            with pytest.raises(notices.NoticeError) as exc:
                await notices.record_due_date(
                    pool, ORG, NOTICE, as_of=TODAY,
                    due_on_override=date(2026, 9, 15),
                )
            assert "history" in str(exc.value)
            assert not pool.ran("SET due_on_override")

    async def test_an_escalated_notice_can_still_be_extended(self):
        pool = self._pool(state=notice_state(status="escalated"))
        assert await notices.record_due_date(
            pool, ORG, NOTICE, as_of=TODAY,
            due_on_override=date(2026, 9, 15),
        ) is not None

    async def test_a_date_before_service_is_refused(self):
        with pytest.raises(notices.NoticeError) as exc:
            await notices.record_due_date(
                self._pool(), ORG, NOTICE, as_of=TODAY,
                due_on_override=date(2026, 7, 1),
            )
        assert "before the notice was served" in str(exc.value)


# ══════════════════════════════════════════════════════════════════════════════
#  4 · The statements themselves
#
#  A MagicMock pool cannot prove that Postgres filtered anything — it echoes the
#  fixture back. What it CAN be made to prove is that the predicate is still
#  written, that every parameter still carries its type, and that `notes` is
#  still concatenated rather than assigned. Deleting any of those leaves every
#  behavioural test above green.
# ══════════════════════════════════════════════════════════════════════════════

def _uncommented(sql: str) -> str:
    """The statement with its `--` comments stripped.

    Not tidiness. `_JOINS` in `notices.py` explains its org-scoped join in a
    comment that QUOTES `$1`, and `test_notice_register.py` records the same
    trap from the other side: its first version asserted a predicate against the
    raw statement and PASSED with that predicate deleted, because the comment
    explaining it repeated the words. A test a comment can satisfy is testing
    the prose.
    """
    return "\n".join(
        line for line in sql.splitlines() if not line.strip().startswith("--")
    )


def _write_statements() -> dict[str, str]:
    """Every statement the write paths run, selected by what it DOES rather than
    by a hand-kept list — so a statement added later is covered on the day it is
    written rather than the day somebody remembers to add it here."""
    out: dict[str, str] = {}
    for module in (dsc, udin, notices):
        for name in dir(module):
            value = getattr(module, name)
            if not isinstance(value, str) or not name.startswith("_"):
                continue
            if not any(verb in value for verb in
                       ("INSERT INTO public.", "UPDATE public.")):
                continue
            out[f"{module.__name__.rsplit('.', 1)[-1]}.{name}"] = _uncommented(
                value
            )
    return out


class TestTheStatements:

    def test_there_is_one_for_every_register(self):
        found = _write_statements()
        assert any("dsc" in k for k in found)
        assert any("udin" in k for k in found)
        assert any("notices" in k for k in found)
        # Eleven: three DSC (insert, revoke, custody), four UDIN (insert,
        # generate, revoke, not-required), three notices (insert, status, due
        # date). Listed as a floor rather than an equality so adding one is not
        # a test failure.
        assert len(found) >= 10, sorted(found)

    def test_every_one_is_scoped_to_the_org(self):
        for name, sql in _write_statements().items():
            assert "$1::uuid" in sql, f"{name} does not bind an org first"
            assert "org_id" in sql, f"{name} does not mention org_id"

    def test_the_org_is_always_the_first_parameter(self):
        # Not merely present: FIRST. A predicate bound the wrong argument is a
        # tenancy leak that reads as a working query.
        for name, sql in _write_statements().items():
            first = re.search(r"\$1::(\w+)", sql)
            assert first and first.group(1) == "uuid", name

    def test_every_bind_parameter_is_cast(self):
        """PgBouncer turns an untyped parameter expression into a parse error
        and an instant 500 with no useful message. It has cost this repo a real
        incident in the credits ledger."""
        for name, sql in _write_statements().items():
            for match in re.finditer(r"\$\d+", sql):
                tail = sql[match.end():match.end() + 2]
                assert tail == "::", f"{name}: {match.group(0)} is not cast"

    def test_every_real_relation_is_schema_qualified(self):
        """A shadow table in `public` has bitten this repo (migration 142) and
        `search_path` here is `"$user", public, extensions`, so an unqualified
        name resolves to the wrong thing or to nothing."""
        cte_names = {"written", "new_row"}
        for name, sql in _write_statements().items():
            for match in re.finditer(r"\b(?:FROM|JOIN|INTO|UPDATE)\s+(\S+)",
                                     sql):
                relation = match.group(1)
                if relation in cte_names:
                    continue
                assert relation.startswith(("staging.", "public.")), \
                    f"{name}: {relation}"

    def test_notes_are_appended_and_never_assigned(self):
        """A reason recorded by one person must not delete a reason recorded by
        another. Every statement that touches `notes` concatenates."""
        for name, sql in _write_statements().items():
            if "notes" not in sql:
                continue
            if "INSERT INTO" in sql and "UPDATE" not in sql:
                continue  # a fresh row has nothing to append to
            assert "concat_ws" in sql, f"{name} assigns notes"

    def test_recorded_dates_are_kept_by_coalesce(self):
        """`replied_on` and `closed_on` are written with COALESCE, so a second
        click can never quietly restate when a reply was filed."""
        sql = notices._UPDATE_STATUS
        assert "replied_on = COALESCE(r.replied_on," in sql
        assert "closed_on  = COALESCE(r.closed_on," in sql

    def test_no_write_statement_does_date_arithmetic(self):
        """The windows live in Python, in one place each, reachable without a
        database. An `interval` or a `+ 60` in here would be a second
        implementation that no test in this suite could reach."""
        for name, sql in _write_statements().items():
            low = sql.lower()
            assert "interval" not in low, name
            assert "current_date" not in low, name
            # `now()` is allowed nowhere: the clock is the application's, so
            # that a test can bind it and a caller can reason about it.
            assert "now()" not in low, name

    def test_the_tenancy_proof_is_in_the_statement_not_in_a_prior_check(self):
        """Check-then-write leaves a window another request can slip through.
        Every create proves the parent belongs to the org in the same statement
        that writes the child — the shape `offboarding.record_custody` uses."""
        assert "AND c.org_id = $1::uuid" in dsc._INSERT_CERTIFICATE
        assert "AND c.org_id = $1::uuid" in udin._INSERT_SIGNING
        assert "AND c.org_id = $1::uuid" in notices._INSERT_NOTICE
        assert "t.org_id IS NULL OR t.org_id = $1::uuid" in notices._INSERT_NOTICE

    def test_an_absent_client_is_a_branch_of_the_where_and_not_an_omission(self):
        """`client_id` NULL means the PRACTICE'S OWN certificate, not "any
        client" — the misreading `dsc.for_client` warns about three times."""
        assert "WHERE $2::uuid IS NULL" in dsc._INSERT_CERTIFICATE
        assert "WHERE $2::uuid IS NULL" in udin._INSERT_SIGNING

    def test_the_lifecycle_updates_pin_the_state_they_expect(self):
        assert "AND status = 'signed'" in udin._UPDATE_GENERATION
        assert "AND status = 'generated'" in udin._UPDATE_REVOCATION
        assert "AND status = 'signed'" in udin._UPDATE_NOT_REQUIRED
        assert "AND d.revoked_on IS NULL" in dsc._UPDATE_REVOCATION
        assert "AND r.status = $7::text" in notices._UPDATE_STATUS


class TestTheVocabulariesMatchTheMigrations:
    """Read off the migration rather than restated, so a test cannot agree with
    itself while the schema drifts. The values were also confirmed against
    `pg_constraint` on the live server on 2026-08-21 — an inline CHECK on ADD
    COLUMN IF NOT EXISTS is skipped when the column already exists, so a
    migration file alone is not evidence of what is enforced."""

    def _check_values(self, migration: str, column: str) -> set[str]:
        sql = (MIGRATIONS / migration).read_text(encoding="utf-8")
        found = re.search(
            re.escape(column) + r".*?CHECK\s*\(\s*" + re.escape(column)
            + r"\s+IN\s*\((.*?)\)\s*\)",
            sql, re.S,
        )
        assert found, f"no CHECK ... IN (...) for {column!r} in {migration}"
        return set(re.findall(r"'([a-z0-9_]+)'", found.group(1)))

    @pytest.mark.parametrize("column,names", [
        ("holder_kind", "HOLDER_KINDS"),
        ("certificate_class", "CERTIFICATE_CLASSES"),
        ("certificate_type", "CERTIFICATE_TYPES"),
        ("custody_status", "CUSTODY_STATES"),
        ("token_kind", "TOKEN_KINDS"),
    ])
    def test_dsc(self, column, names):
        assert set(getattr(dsc, names)) == self._check_values(
            "160_dsc_register.sql", column
        )

    def test_the_one_usable_custody_state_is_still_a_whitelist(self):
        """A custody state added to the migration later defaults to "we cannot
        use it", which is the safe direction to be wrong in."""
        assert dsc._CUSTODY_USABLE == frozenset({"with_firm"})
        assert dsc._CUSTODY_USABLE < set(dsc.CUSTODY_STATES)

    def test_notice_statuses(self):
        sql = (MIGRATIONS / "162_notice_register.sql").read_text(
            encoding="utf-8")
        found = re.search(
            r"notice_register_status_ck\s*CHECK\s*\(status IN \((.*?)\)\)",
            sql, re.S,
        )
        assert found
        assert set(notices.NOTICE_STATUSES) == set(
            re.findall(r"'([a-z_]+)'", found.group(1))
        )

    def test_every_terminal_status_is_a_real_status(self):
        assert set(notices.TERMINAL_STATUSES) < set(notices.NOTICE_STATUSES)
        for terminal in notices.TERMINAL_STATUSES:
            assert notices._TRANSITIONS[terminal] == ()

    def test_every_transition_target_is_a_real_status(self):
        assert set(notices._TRANSITIONS) == set(notices.NOTICE_STATUSES)
        for source, targets in notices._TRANSITIONS.items():
            for target in targets:
                assert target in notices.NOTICE_STATUSES, (source, target)
                assert target != source


# ══════════════════════════════════════════════════════════════════════════════
#  5 · The router — gates, and the clock
# ══════════════════════════════════════════════════════════════════════════════

WRITE_ROUTES = [
    ("POST", "/api/v1/custody/dsc"),
    ("POST", "/api/v1/custody/dsc/{certificate_id}/revoke"),
    ("POST", "/api/v1/custody/dsc/{certificate_id}/custody"),
    ("POST", "/api/v1/custody/udin"),
    ("POST", "/api/v1/custody/udin/{entry_id}/generate"),
    ("POST", "/api/v1/custody/udin/{entry_id}/revoke"),
    ("POST", "/api/v1/custody/udin/{entry_id}/not-required"),
    ("POST", "/api/v1/custody/notices"),
    ("POST", "/api/v1/custody/notices/{notice_id}/status"),
    ("POST", "/api/v1/custody/notices/{notice_id}/due-date"),
]

WRITE_HANDLERS = (
    "dsc_create", "dsc_revoke", "dsc_custody",
    "udin_create", "udin_generate", "udin_revoke", "udin_not_required",
    "notice_create", "notice_status", "notice_due_date",
)


@pytest.fixture
def custody_app():
    from fastapi import FastAPI
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded

    from auth_router import require_user
    from limiter import limiter
    from middleware.org_resolver import get_org_id

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(custody_mod.router)

    app.dependency_overrides[custody_mod._gate] = lambda: frozenset({"admin"})
    app.dependency_overrides[custody_mod._notice_gate] = lambda: CALLER
    app.dependency_overrides[get_org_id] = lambda: ORG
    app.dependency_overrides[require_user] = lambda: CALLER
    return app


@pytest.fixture
async def cc(custody_app):
    async with AsyncClient(
        transport=ASGITransport(app=custody_app), base_url="http://test"
    ) as client:
        yield client


@pytest.fixture
def levels(custody_app):
    def _set(*held):
        custody_app.dependency_overrides[custody_mod._gate] = (
            lambda: frozenset(held)
        )
    return _set


def test_every_write_route_exists():
    """Listed one by one rather than counted: a count still passes when a route
    is renamed and its screen 404s."""
    have = {(method, route.path)
            for route in custody_mod.router.routes
            for method in getattr(route, "methods", ())}
    for method, path in WRITE_ROUTES + [("GET", "/api/v1/custody/clients")]:
        assert (method, path) in have, f"{method} {path} is missing"


def test_no_write_route_takes_a_clock_from_the_caller():
    """`as_of` is a query parameter on every READ in that file and on NO write.

    A read is a question about a date the caller chooses. A write is happening
    NOW, and a caller-supplied "now" on a register with two statutory windows in
    it is a caller who can move a deadline.
    """
    for name in WRITE_HANDLERS:
        params = inspect.signature(getattr(custody_mod, name)).parameters
        for forbidden in ("as_of", "now"):
            assert forbidden not in params, f"{name} takes {forbidden}"


def test_no_write_body_carries_a_clock_either():
    from pydantic import BaseModel

    for name in dir(custody_mod):
        value = getattr(custody_mod, name)
        if not (isinstance(value, type) and issubclass(value, BaseModel)
                and value is not BaseModel):
            continue
        for forbidden in ("as_of", "now"):
            assert forbidden not in value.model_fields, f"{name}.{forbidden}"


def test_the_write_surface_still_contains_no_sql():
    """Every statement lives in a service module, schema-qualified and bound.
    A second implementation of a window or a tenancy predicate written into a
    router is one no test looks at."""
    import ast

    tree = ast.parse(inspect.getsource(custody_mod))
    for node in ast.walk(tree):
        if (isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                              ast.AsyncFunctionDef))
                and ast.get_docstring(node) is not None):
            node.body = node.body[1:]
    code = ast.unparse(tree)
    for word in ("SELECT ", "INSERT ", "UPDATE ", "DELETE FROM"):
        assert word not in code, f"{word.strip()} is written into the router"


async def test_a_viewer_may_read_every_register_and_write_to_none(
    cc, levels, mock_pool,
):
    """One rung above the read bar on every write. A person who may look at the
    DSC register is not thereby a person who may add a certificate to it."""
    levels("viewer")
    mock_pool.fetch.return_value = []
    assert (await cc.get("/api/v1/custody/dsc")).status_code == 200

    bodies = {
        "/api/v1/custody/dsc": {"holder_name": "A", "valid_from": "2025-01-01",
                                "valid_to": "2026-01-01"},
        f"/api/v1/custody/dsc/{CERT}/revoke": {"revoked_on": "2026-01-01"},
        f"/api/v1/custody/dsc/{CERT}/custody": {"custody_status": "with_client"},
        "/api/v1/custody/udin": {"document_kind": "certificate",
                                 "document_title": "X", "signed_on": "2026-08-01",
                                 "signed_by_member": "CA A",
                                 "client_name": "Y"},
        f"/api/v1/custody/udin/{ENTRY}/generate": {"udin": "26304576AKTSBN1359"},
        f"/api/v1/custody/udin/{ENTRY}/revoke": {"reason": "wrong"},
        f"/api/v1/custody/udin/{ENTRY}/not-required": {"reason": "not one"},
        "/api/v1/custody/notices": {"client_id": CLIENT,
                                    "notice_type_code": "gst_asmt_10",
                                    "reference_no": "X",
                                    "received_on": "2026-08-01"},
        f"/api/v1/custody/notices/{NOTICE}/status": {"status": "replied"},
        f"/api/v1/custody/notices/{NOTICE}/due-date": {
            "due_on_override": "2026-09-15"},
    }
    for path, body in bodies.items():
        resp = await cc.post(path, json=body)
        assert resp.status_code == 403, (path, resp.status_code, resp.text)


async def test_self_scope_reaches_no_write_at_all(cc, levels, mock_pool):
    """The empty level set is what every employee in the organisation holds by
    default — "read your own HR record". None of these registers is anybody's
    own row."""
    levels()
    mock_pool.fetch.return_value = []
    assert (await cc.post("/api/v1/custody/dsc", json={
        "holder_name": "A", "valid_from": "2025-01-01",
        "valid_to": "2026-01-01"})).status_code == 403
    assert (await cc.get("/api/v1/custody/clients")).status_code == 403


def test_the_notice_writes_keep_the_higher_gate():
    """A notice write must never be easier to reach than the notice read it
    changes. `_notice_gate` is org_owner / org_admin — the same bar
    `routers/manav.py` puts on reading an employee's Aadhaar."""
    for name in ("notice_create", "notice_status", "notice_due_date"):
        params = inspect.signature(getattr(custody_mod, name)).parameters
        assert "_admin" in params, f"{name} is not behind the notice gate"


async def test_the_notice_gate_refusal_is_a_403_and_nothing_is_written(
    custody_app, cc, mock_pool,
):
    from fastapi import HTTPException as _HTTPException

    def _refuse():
        raise _HTTPException(403, "Only an organisation owner or administrator "
                                  "may open the notice register.")

    custody_app.dependency_overrides[custody_mod._notice_gate] = _refuse
    resp = await cc.post("/api/v1/custody/notices", json={
        "client_id": CLIENT, "notice_type_code": "gst_asmt_10",
        "reference_no": "X", "received_on": "2026-08-01",
    })
    assert resp.status_code == 403
    assert not mock_pool.fetchrow.called


async def test_a_service_refusal_becomes_a_422_in_its_own_words(cc, mock_pool):
    """The service module's sentence is the only text that says what to do
    next. Replacing it with "invalid request" throws that away."""
    mock_pool.fetch.return_value = []
    resp = await cc.post("/api/v1/custody/dsc", json={
        "holder_name": "Anil Sharma",
        "valid_from": "2027-02-28", "valid_to": "2025-03-01",
    })
    assert resp.status_code == 422
    assert "transposed" in resp.json()["detail"]


async def test_a_derived_status_sent_to_the_router_is_refused_with_the_lever(
    cc, mock_pool,
):
    mock_pool.fetch.return_value = []
    resp = await cc.post("/api/v1/custody/dsc", json={
        "holder_name": "Anil Sharma", "valid_from": "2025-03-01",
        "valid_to": "2027-02-28", "status": "revoked",
    })
    assert resp.status_code == 422
    assert "record_revocation" in resp.json()["detail"]


async def test_a_parent_from_another_org_is_a_409_that_says_nothing_more(
    cc, mock_pool,
):
    """The statement inserted nothing because the client is not this org's. The
    sentence must not say whether that client exists somewhere else."""
    mock_pool.fetchrow.return_value = None
    mock_pool.fetch.return_value = []
    resp = await cc.post("/api/v1/custody/dsc", json={
        "holder_name": "Anil Sharma", "valid_from": "2025-03-01",
        "valid_to": "2027-02-28", "client_id": CLIENT,
    })
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert "does not belong to this organisation" in detail
    assert "exists" not in detail


async def test_a_created_certificate_comes_back_shaped_like_a_list_row(
    cc, mock_pool,
):
    mock_pool.fetchrow.return_value = dsc_written()
    mock_pool.fetch.return_value = []
    resp = await cc.post("/api/v1/custody/dsc", json={
        "holder_name": "Anil Sharma", "valid_from": "2025-03-01",
        "valid_to": "2027-02-28",
    })
    assert resp.status_code == 201
    row = resp.json()
    for key in ("status", "days_to_expiry", "warnings", "client_name",
                "belongs_to_firm"):
        assert key in row, key
    assert "org_id" not in row and "client_id" not in row


async def test_the_client_picker_returns_names_and_nothing_else(cc, mock_pool):
    mock_pool.fetch.return_value = [{"id": CLIENT, "name": "Sharma Textiles"}]
    resp = await cc.get("/api/v1/custody/clients")
    assert resp.status_code == 200
    assert resp.json()["data"] == [{"id": CLIENT, "name": "Sharma Textiles"}]
