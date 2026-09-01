"""A web form can be published pointing somewhere other than the CRM.

── THE DEFECT THESE COVER ────────────────────────────────────────────────────

Migration 251 added `graha_web_forms.destination`, `submit_web_form` has
dispatched on it since the day it shipped, and `services/webforms/destinations.py`
carries a tested handler for `hr_application`. None of it could ever run.
`WebFormCreate` had no `destination` field, so every form the product could
create took the column default. Measured against production on 2026-09-01:

    SELECT destination, count(*), sum(submission_count)
      FROM public.graha_web_forms GROUP BY destination;
    -> crm_contact | 2 | 24        (and no other row)

Two forms, both CRM, 24 real submissions, zero of anything else — an engine
supported end to end and unreachable from any screen. Nothing errors in that
state; the feature is simply not there, which is why it survived review.

── AND THE SECOND ONE ────────────────────────────────────────────────────────

`read_web_form` is unauthenticated and returned `name` and `fields`. To let a
template reword the five fixed boxes it now also answers a presentation block —
and the obvious way to do that, returning `settings`, would hand a stranger
`job_opening_id`: the exact value `land_hr_application` refuses to read from a
payload because "a uuid in a public payload is a parameter, not a secret".
`_presentation()` therefore BUILDS a new dict from three named keys. These tests
hold that line, because the failure is invisible — a leaked key looks like a
successful response.
"""
import json

import pytest
from fastapi import HTTPException

from services.webforms.destinations import (
    ALLOWED_DESTINATIONS,
    DESTINATIONS,
    handler_for,
    validate_destination,
)
from routers.graha import _presentation, _PUBLIC_FIELD_KEYS


# ── the allowlist and the dispatcher agree ───────────────────────────────────

def test_every_allowed_destination_can_actually_be_served():
    """No value may pass validation that `handler_for` then refuses.

    The two live in one file precisely so they cannot drift, but "cannot drift"
    is the claim, and this is the check. A destination that validates and then
    500s is worse than one refused at create: the firm has published the slug.
    """
    for dest in ALLOWED_DESTINATIONS:
        handler_for(dest)  # raises HTTPException(500) if unserveable


def test_crm_contact_is_allowed_but_owns_no_handler_here():
    """The inline CRM path is deliberately not in DESTINATIONS."""
    assert "crm_contact" in ALLOWED_DESTINATIONS
    assert "crm_contact" not in DESTINATIONS
    assert handler_for("crm_contact") is None


def test_hr_application_is_reachable_at_all():
    """The anti-vacuity floor.

    Every other test in this file passes over an allowlist of exactly
    {'crm_contact'} — which IS the state the product was in, and the state a
    tidy-up that deleted the unused handler would restore.
    """
    assert ALLOWED_DESTINATIONS - {"crm_contact"}, "no non-CRM destination is reachable"
    assert "hr_application" in ALLOWED_DESTINATIONS


# ── validate_destination ─────────────────────────────────────────────────────

def test_unknown_destination_is_refused():
    with pytest.raises(HTTPException) as e:
        validate_destination("vendor_portal", {})
    assert e.value.status_code == 400


def test_crm_contact_needs_no_settings():
    validate_destination("crm_contact", {})


def test_hr_application_without_an_opening_is_refused_at_create():
    """Named at create, not discovered by the first applicant.

    `land_hr_application` already refuses this at submit time, correctly. But by
    then the firm has put the slug on their careers page, and the person who
    finds out is a candidate being told the role is not accepting applications.
    """
    with pytest.raises(HTTPException) as e:
        validate_destination("hr_application", {})
    assert e.value.status_code == 400
    assert "job opening" in e.value.detail.lower()


@pytest.mark.parametrize("blank", [None, "", "   ", {}])
def test_hr_application_blank_opening_is_refused(blank):
    settings = {} if blank in (None, {}) else {"job_opening_id": blank}
    with pytest.raises(HTTPException):
        validate_destination("hr_application", settings)


def test_hr_application_with_an_opening_passes():
    validate_destination(
        "hr_application", {"job_opening_id": "11111111-1111-1111-1111-111111111111"}
    )


# ── _presentation: what a stranger may see ───────────────────────────────────

def test_presentation_never_returns_the_job_opening_id():
    """The one that matters. A copied blob would leak the guarded uuid."""
    out = _presentation({
        "job_opening_id": "11111111-1111-1111-1111-111111111111",
        "presentation": {"intro": "Apply here"},
    })
    assert "job_opening_id" not in json.dumps(out)


def test_presentation_copies_nothing_it_was_not_told_to():
    """A settings blob that grows a key next year stays private by default.

    ⚠ THE SECRETS SIT AT BOTH LEVELS ON PURPOSE. A first draft of this test put
    them only at the top of `settings`, and a mutation that spread the INNER
    presentation block passed it — the assertion was satisfied by the shape of
    its own fixture, because that fixture's inner block happened to hold nothing
    worth leaking. Both nestings are populated so that neither `{**settings}`
    nor `{**block}` can survive.
    """
    out = _presentation({
        "presentation": {
            "intro": "hi",
            "notify_email": "partner@firm.example",
            "crm_owner_id": "22222222-2222-2222-2222-222222222222",
        },
        "webhook_secret": "s3cret",
        "job_opening_id": "11111111-1111-1111-1111-111111111111",
    })
    assert set(out) == {"intro", "labels", "hide"}
    blob = json.dumps(out)
    for secret in ("s3cret", "partner@firm.example", "11111111", "22222222"):
        assert secret not in blob, secret


def test_presentation_drops_labels_for_fields_the_server_discards():
    out = _presentation({"presentation": {"labels": {"pan": "Your PAN", "email": "Work email"}}})
    assert out["labels"] == {"email": "Work email"}


def test_presentation_refuses_to_hide_the_name():
    """Hiding it would draw a form that can never be submitted."""
    out = _presentation({"presentation": {"hide": ["name", "company"]}})
    assert out["hide"] == ["company"]


def test_presentation_drops_hides_for_unknown_fields():
    out = _presentation({"presentation": {"hide": ["gstin", "phone"]}})
    assert out["hide"] == ["phone"]


@pytest.mark.parametrize("junk", [None, {}, {"presentation": None}, {"presentation": "nope"},
                                  {"presentation": {"labels": "nope", "hide": "nope"}}])
def test_presentation_survives_junk(junk):
    """`settings` is free-form jsonb a firm controls; nothing here may 500."""
    out = _presentation(junk)
    assert isinstance(out, dict)


def test_presentation_accepts_settings_stored_as_a_string():
    """asyncpg hands jsonb back as text on some paths and dict on others."""
    out = _presentation(json.dumps({"presentation": {"intro": "Apply here"}}))
    assert out["intro"] == "Apply here"


def test_presentation_truncates_rather_than_letting_a_form_break_a_page():
    out = _presentation({"presentation": {
        "intro": "x" * 5000,
        "labels": {"email": "y" * 5000},
    }})
    assert len(out["intro"]) == 300
    assert len(out["labels"]["email"]) == 80


def test_public_field_keys_are_the_five_the_submit_handler_reads():
    """If the server learns a sixth key, this list is what has to change."""
    assert _PUBLIC_FIELD_KEYS == {"name", "email", "phone", "company", "message"}
