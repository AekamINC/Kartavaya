"""Altitude, end to end — the half of the geofence that only existed in the schema.

Migration 193 added `pahchan_sites.altitude_m` / `altitude_tolerance_m` and
`pahchan_punches.altitude_m` / `altitude_accuracy_m` on 2026-08-22, and NOTHING
wrote or read any of them. The mobile client read lat, lng and accuracy off the
geolocation fix and stopped, with altitude sitting in the same object.

── WHY IT IS WORTH HAVING ──────────────────────────────────────────────────
One thing a horizontal fence cannot do: a multi-storey site. Two floors of one
building are the same latitude and longitude to within a metre, so no radius
separates the warehouse from the office above it. Vertical separation does —
when the site says what its floor is worth.

── THE RULE THAT MATTERS MORE THAN THE FEATURE ─────────────────────────────
`None` is not zero, at both ends:

  · a DEVICE that reports no altitude is ordinary — indoors, and on some
    Android hardware always — and must never be flagged for it. Defaulting to
    0 would put every silent phone at sea level and flag every punch at a site
    above it.
  · a SITE that declares no altitude behaves exactly as it did before 193.
    That is the default, and it is the right one: consumer GPS altitude is far
    noisier than the horizontal fix, so a ground-floor office gains nothing
    from a test that flags honest punches on a cloudy day.

And the module's own standing rule, 07 §2: every branch RECORDS and flags.
Nothing here refuses a punch, and the test at the foot of this file is what
stops that changing by accident.
"""
import inspect

import pytest

from routers import pahchan
from routers.pahchan import _altitude_gap_m, _compute_flags


class _Body:
    """The three fields `_compute_flags` reads, and nothing else.

    A real `PunchBody` needs a captured_at, a direction and a client_punch_id
    that have no bearing on any assertion here; this keeps each test about the
    one number it is testing.
    """

    def __init__(self, *, lat=19.07, lng=72.87, accuracy_m=12.0,
                 mock_location=False, source="live", retry_count=0):
        self.lat = lat
        self.lng = lng
        self.accuracy_m = accuracy_m
        self.mock_location = mock_location
        self.source = source
        self.retry_count = retry_count


POLICY = {"accuracy_flag_threshold_m": 100}


def _flags(**kw):
    return _compute_flags(
        _Body(), POLICY, distance_m=kw.pop("distance_m", 10.0),
        site_radius_m=kw.pop("site_radius_m", 150),
        has_reference_pair=True, **kw,
    )


# ── The gap ─────────────────────────────────────────────────────────────────

def test_the_gap_is_the_absolute_difference():
    """Below the floor is as far from it as above. Somebody in the basement
    car park of a first-floor site is outside it in both directions."""
    assert _altitude_gap_m(30.0, 12.0, 10) == 18.0
    assert _altitude_gap_m(-6.0, 12.0, 10) == 18.0


@pytest.mark.parametrize("reported, site_alt, tolerance", [
    (None, 12.0, 10),     # the device said nothing — ordinary indoors
    (30.0, None, 10),     # the site declares no altitude — 193's default
    (30.0, 12.0, None),   # a floor with no window around it
    (None, None, None),
])
def test_the_question_is_not_asked_unless_all_three_are_known(reported, site_alt, tolerance):
    assert _altitude_gap_m(reported, site_alt, tolerance) is None


def test_a_device_reporting_sea_level_is_not_a_device_reporting_nothing():
    """0.0 is a reading. `None` is the absence of one. Conflating them is the
    exact mistake migration 193's header warns about at the other end."""
    assert _altitude_gap_m(0.0, 12.0, 10) == 12.0
    assert _altitude_gap_m(None, 12.0, 10) is None


# ── The flag ────────────────────────────────────────────────────────────────

def test_a_punch_on_the_wrong_floor_is_flagged():
    """The whole point: horizontally inside, vertically out."""
    flags = _flags(altitude_gap_m=18.0, site_altitude_tolerance_m=10)
    assert "geo" in flags


def test_a_punch_within_the_tolerance_is_not_flagged():
    flags = _flags(altitude_gap_m=6.0, site_altitude_tolerance_m=10)
    assert "geo" not in flags


def test_exactly_on_the_tolerance_is_inside_it():
    """A tolerance is what is allowed, not what is refused."""
    assert "geo" not in _flags(altitude_gap_m=10.0, site_altitude_tolerance_m=10)


def test_a_site_that_declares_no_altitude_behaves_as_it_did_before_193():
    assert _flags(altitude_gap_m=None, site_altitude_tolerance_m=None) == []


def test_a_device_that_cannot_report_altitude_is_never_flagged_for_it():
    """The failure that would have made this feature harmful rather than
    useful: an Android handset that reports no altitude, punching at a site
    that checks it."""
    assert "geo" not in _flags(altitude_gap_m=None, site_altitude_tolerance_m=10)


def test_geo_is_reused_rather_than_a_new_flag_code():
    """It is the same finding — the punch is not where the site is — and every
    consumer of `flags` already knows what `geo` means: the review screen, the
    attendance bridge, the reports and the mobile client."""
    flags = _flags(altitude_gap_m=99.0, site_altitude_tolerance_m=10)
    assert flags == ["geo"]


def test_a_punch_outside_both_fences_is_flagged_once():
    """Not twice. `flags` is rendered as a list of reasons, and the same word
    twice reads as two separate findings."""
    flags = _flags(distance_m=400.0, site_radius_m=150,
                   altitude_gap_m=99.0, site_altitude_tolerance_m=10)
    assert flags.count("geo") == 1


# ── The site ────────────────────────────────────────────────────────────────

def test_a_tolerance_without_an_altitude_is_refused_with_a_sentence():
    """`pahchan_sites_altitude_pair_ck` refuses it too, with a constraint name.
    The person filling in the form gets the sentence instead."""
    with pytest.raises(ValueError) as exc:
        pahchan.SiteBody(name="Tower", lat=19.07, lng=72.87,
                         altitude_tolerance_m=10)
    assert "needs an altitude" in str(exc.value)


def test_a_site_may_still_be_created_with_neither():
    site = pahchan.SiteBody(name="Ground floor", lat=19.07, lng=72.87)
    assert site.altitude_m is None and site.altitude_tolerance_m is None


@pytest.mark.parametrize("bad", [-600.0, 9500.0])
def test_an_impossible_altitude_is_refused(bad):
    """The bounds mirror migration 193's CHECK — Dead Sea shore to above
    Everest — so a typo is refused here rather than at the database."""
    with pytest.raises(ValueError):
        pahchan.SiteBody(name="Nowhere", lat=19.07, lng=72.87, altitude_m=bad)


def test_a_zero_or_negative_tolerance_is_refused():
    with pytest.raises(ValueError):
        pahchan.SiteBody(name="Tower", lat=19.07, lng=72.87,
                         altitude_m=12.0, altitude_tolerance_m=0)


# ── The amend path, which did not exist at all ──────────────────────────────

def test_a_site_can_now_be_amended():
    """There was `POST` and `GET` and nothing between them, so a radius typed
    wrong or a pin dropped on the wrong side of a building meant creating a
    second site and leaving the first one flagging every punch at it."""
    assert hasattr(pahchan, "amend_site")


def test_the_amend_set_clause_is_allowlisted():
    """The identifier is interpolated into the SET clause."""
    assert "org_id" not in pahchan._SITE_AMENDABLE
    assert "id" not in pahchan._SITE_AMENDABLE
    assert set(pahchan._SITE_AMENDABLE) == {
        "name", "lat", "lng", "radius_m",
        "altitude_m", "altitude_tolerance_m", "is_active",
    }


def test_clearing_the_altitude_clears_both_columns():
    """A tolerance with no altitude is what the pair constraint refuses, so
    clearing one without the other would be refused by the database with a
    constraint name instead of a sentence."""
    src = inspect.getsource(pahchan.amend_site)
    block = src[src.index("if body.clear_altitude:"):][:400]
    assert 'updates["altitude_m"] = None' in block
    assert 'updates["altitude_tolerance_m"] = None' in block


def test_a_site_is_deactivated_and_never_deleted():
    """`pahchan_punches.geofence_id` names the site on every punch ever
    recorded at it. Deleting one orphans those rows or takes the attendance
    history with it."""
    assert "is_active" in pahchan._SITE_AMENDABLE
    src = inspect.getsource(pahchan)
    assert "DELETE FROM public.pahchan_sites" not in src


# ── The employee sees the rule they are judged by ───────────────────────────

def test_the_rules_helper_states_the_sites_and_the_thresholds():
    src = inspect.getsource(pahchan._rules_for_employee)
    for field in ("grace_minutes", "accuracy_flag_threshold_m",
                  "altitude_tolerance_m", "flag_meanings", "checks_altitude"):
        assert field in src


def test_the_rules_carry_no_facts_about_any_other_person():
    """A site is a place, not a person. Nothing here names a colleague, a
    reviewer, or an employee id."""
    src = inspect.getsource(pahchan._rules_for_employee)
    assert "employee_id" not in src
    assert "reviewed_by" not in src
    # And the site query selects a name and three numbers — no ids at all.
    assert "SELECT name, radius_m, altitude_m, altitude_tolerance_m" in src


def test_both_branches_of_me_answer_with_the_rules():
    """The unlinked branch is the COMMON one — employee rows carrying a
    `user_id` are still a small minority — and it is exactly the person most
    likely to be wondering what happens when they punch."""
    src = inspect.getsource(pahchan.my_punches)
    # `await _rules_for_employee(` — the CALL, twice. The bare name appears a
    # third time in a comment explaining what the block is for.
    assert src.count("await _rules_for_employee(") == 2


def test_the_rules_never_come_from_the_defaults_in_this_file():
    """An employee reading a hardcoded 100m while their org runs at 40m is the
    same failure `_retention` was fixed for on 6 August."""
    src = inspect.getsource(pahchan._rules_for_employee)
    assert "DEFAULT_POLICY" not in src


# ── The rule that outranks the feature ──────────────────────────────────────

def test_nothing_in_the_flag_computation_refuses_a_punch():
    """07 §2. Every branch records and flags; adding a refusal here is the
    single change most likely to break this module's purpose."""
    src = inspect.getsource(_compute_flags)
    assert "HTTPException" not in src
    assert "raise" not in src
