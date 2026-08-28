"""Phase 8.4 — DIGIPIN, and the four ways a grid code lies quietly.

`services/digipin.py` has no network, no key and no database, so the usual
question — "did the integration work" — does not exist here. What exists instead
is a function that will cheerfully return ten plausible characters for almost any
input, and four ways that goes wrong without anybody noticing:

  1. THE ALGORITHM IS SUBTLY WRONG. Ten levels of a 4x4 grid produce a
     well-formed code from any grid orientation, any row order, any tie-break.
     Only a value from India Post decides which one is right. The technical
     document publishes exactly ONE (Dak Bhawan, §5) and it is asserted first,
     because a mirrored latitude axis passes every round-trip test in this file
     and puts Delhi in the Bay of Bengal.

  2. THE CODE IS RIGHT AND THE COORDINATE WAS OUTSIDE INDIA. The grid stops at
     the bounding box; a coordinate in Colombo or Kabul has no DIGIPIN. Anything
     that returns a code for one has invented an Indian address.

  3. A DECODED CELL IS MISTAKEN FOR A FIX. A DIGIPIN is ~3.8 m of area. The
     centre is not where anything is.

  4. IT LEARNS TO PHONE HOME. The entire reason DIGIPIN is in the plan rather
     than a geocoding vendor is that it costs nothing and depends on nobody.
     That is a property of the source text, so it is asserted against the source
     text — the same guard `test_mappls_token.py` puts on `services/mappls.py`
     after that module spent months calling an endpoint for the wrong credential.

── THE REFERENCE IMPLEMENTATION IN THIS FILE ────────────────────────────────

`_official_get_digipin` below is a line-by-line transcription of Annexure 1 of
the Department of Posts' technical document (Final version, March 2025), read
from the PDF on 2026-08-28, JS control flow and all — including the loop that
leaves `row` at its previous value when nothing matches, and the block its
authors commented "NEWLY ADDED TO ADDRESS BOUNDARY CONDITION".

It is deliberately ugly and deliberately NOT refactored. Its whole value is that
it was not written by the person who wrote `services/digipin.py`: it is the
Department's control flow, so agreement between the two is evidence about the
algorithm rather than evidence that one function calls another. With only one
published fixture in existence, this is the second opinion.
"""
from __future__ import annotations

import inspect
import math
import random

import pytest

from services import digipin
from services.digipin import (
    CoordinateOutOfRange,
    DigipinError,
    MalformedDigipin,
    decode,
    encode,
    encode_or_none,
    is_within_grid,
    normalise,
)

#: The one worked example the Department of Posts publishes: technical document
#: §5, "The DIGIPIN of Dak Bhawan is 39J 49L L8T4", with Figure 4 showing the
#: symbol chosen at each of the ten levels. Everything else in this file is
#: internal consistency; this line is the only external truth available.
DAK_BHAWAN = (28.622788, 77.213033)
#: ⚠ NO HYPHENS. The document prints it "39J 49L L8T4" and Annexure 1 groups
#: it `XXX-XXX-XXXX`, but India Post's reference implementation was updated on
#: 2026-05-04 to emit ten continuous characters and says so twice: "Output is a
#: single, uninterrupted string (no spaces or separators)". `encode` follows the
#: implementation, `decode` still accepts the grouped spelling, and
#: `format_grouped` is available for a screen. Verified symbol-for-symbol
#: against `github.com/INDIAPOST-gov/digipin` over 20,000 random coordinates.
DAK_BHAWAN_DIGIPIN = "39J49LL8T4"

#: Half a level-10 cell: 36 / 4**10 / 2 degrees. The floor on round-trip error
#: for any grid code, and therefore the number the precision test asserts.
HALF_CELL_DEG = 36 / 4**10 / 2


# ══════════════════════════════════════════════════════════════════════════════
#  Annexure 1, transcribed. Do not tidy this — see the module docstring.
# ══════════════════════════════════════════════════════════════════════════════

_L = [
    ["F", "C", "9", "8"],
    ["J", "3", "2", "7"],
    ["K", "4", "5", "6"],
    ["L", "M", "P", "T"],
]


def _official_get_digipin(lat: float, lon: float) -> str:
    """`Get_DIGIPIN(lat, lon)` from Annexure 1, in Python. Returns '' on refusal
    (the original pops a browser `alert()` and returns an empty string)."""
    v_digipin = ""
    row = 0
    column = 0
    min_lat, max_lat, min_lon, max_lon = 2.5, 38.50, 63.50, 99.50
    lat_div_by = lon_div_by = 4

    if lat < min_lat or lat > max_lat:
        return ""
    if lon < min_lon or lon > max_lon:
        return ""

    for lvl in range(1, 11):
        lat_div_deg = (max_lat - min_lat) / lat_div_by
        lon_div_deg = (max_lon - min_lon) / lon_div_by

        next_max_lat = max_lat
        next_min_lat = max_lat - lat_div_deg
        for x in range(lat_div_by):
            if lat >= next_min_lat and lat < next_max_lat:
                row = x
                break
            else:
                next_max_lat = next_min_lat
                next_min_lat = next_max_lat - lat_div_deg

        next_min_lon = min_lon
        next_max_lon = min_lon + lon_div_deg
        for x in range(lon_div_by):
            if lon >= next_min_lon and lon < next_max_lon:
                column = x
                break
            elif (next_min_lon + lon_div_deg) < max_lon:  # NEWLY ADDED ...
                next_min_lon = next_max_lon
                next_max_lon = next_min_lon + lon_div_deg
            else:
                column = x

        v_digipin += _L[row][column]
        # The reference implementation's grouping line is a NO-OP as of
        # 2026-05-04 (`if (level === 3 || level === 6) digiPin += "";`). This
        # port keeps the branch visible and empty for the same reason theirs
        # does: so the next reader sees that it was removed, not forgotten.
        if lvl == 3 or lvl == 6:
            v_digipin += ""

        min_lat, max_lat = next_min_lat, next_max_lat
        min_lon, max_lon = next_min_lon, next_max_lon

    return v_digipin


# ══════════════════════════════════════════════════════════════════════════════
#  1 · the published value, and the shape of the grid it proves
# ══════════════════════════════════════════════════════════════════════════════

def test_dak_bhawan_matches_the_published_digipin():
    """THE ONLY EXTERNAL FIXTURE THAT EXISTS. If this fails, nothing else in
    this file means anything — a self-consistent wrong grid passes all of it."""
    assert encode(*DAK_BHAWAN) == DAK_BHAWAN_DIGIPIN


def test_dak_bhawans_ten_symbols_are_the_ten_in_figure_4():
    """Figure 4 of the technical document shows the symbol picked at each level:
    3, 9, J, 4, 9, L, L, 8, T, 4. Asserted level by level rather than as one
    string so that a failure names WHICH level diverged — level 1 wrong is a
    bounding-box or orientation fault, level 9 wrong is a precision fault, and
    the two have nothing to do with each other."""
    symbols = encode(*DAK_BHAWAN).replace("-", "")
    assert list(symbols) == ["3", "9", "J", "4", "9", "L", "L", "8", "T", "4"]


def test_the_first_symbol_places_delhi_in_the_right_ninth_of_india():
    """Level 1 alone, stated as geography.

    The level-1 cell is 9 degrees square, so this is the assertion that survives
    any argument about tie-breaks and precision: Delhi is in the second band from
    the north and the second column from the west, which is `3`. A grid whose
    rows run south-to-north instead answers `4` here and stays plausible
    everywhere else in this file.
    """
    assert encode(*DAK_BHAWAN)[0] == "3"
    assert digipin.DIGIPIN_GRID[1][1] == "3"


@pytest.mark.parametrize("corner,symbol,name", [
    ((38.5, 63.5), "F", "north-west"),
    ((38.5, 99.5), "8", "north-east"),
    ((2.5, 63.5), "L", "south-west"),
    ((2.5, 99.5), "T", "south-east"),
])
def test_the_four_corners_of_the_box_are_the_four_corners_of_the_grid(
        corner, symbol, name):
    """Orientation, pinned at every corner at once.

    Each corner encodes to its symbol repeated ten times, because a corner of the
    box is a corner of every nested cell down to level 10. Between them these
    four fix both axes: swap the rows and F/L trade places, swap the columns and
    F/8 do. They also exercise §3.4's exception — 38.5 N and 99.5 E are the two
    edges that belong to the cell below and to the left of them, and without that
    clamp the top and right corners raise or run off the grid.
    """
    assert encode(*corner) == digipin.encode_or_none(*corner)
    assert encode(*corner).replace("-", "") == symbol * 10, name


# ══════════════════════════════════════════════════════════════════════════════
#  2 · agreement with Annexure 1, over the whole box and along the grid lines
# ══════════════════════════════════════════════════════════════════════════════

def test_agrees_with_the_official_algorithm_across_the_whole_box():
    """20,000 pseudo-random in-bounds coordinates, fixed seed.

    The seed is fixed because a randomised test that fails once in CI and passes
    on re-run teaches nobody anything. It is also why the failure message carries
    the coordinate: with 20,000 samples "assert a == b" is not a bug report.
    """
    rnd = random.Random(20260828)
    for _ in range(20_000):
        lat = rnd.uniform(2.5, 38.5)
        lng = rnd.uniform(63.5, 99.5)
        assert encode(lat, lng) == _official_get_digipin(lat, lng), (lat, lng)


def test_agrees_with_the_official_algorithm_exactly_on_the_grid_lines():
    """THE CASE THE EXACT ARITHMETIC EXISTS FOR.

    Every coordinate here sits precisely on a level-10 grid line, which is where
    §3.4's tie-break decides the answer and where a float implementation would
    diverge if it were going to diverge at all. Measured 2026-08-28: it does not
    — 0 mismatches in 20,000 — because the Department's numbers (36, 2.5, 38.5,
    63.5, 99.5) are all dyadic and ten divisions by four stay exact in binary.

    That is luck, not design, and this test is what tells us it still holds. The
    `Fraction` arithmetic in `services/digipin.py` is what means it does not
    matter if it stops.
    """
    rnd = random.Random(20260829)
    step = 36 / 4**10
    for _ in range(20_000):
        lat = min(2.5 + rnd.randrange(4**10 + 1) * step, 38.5)
        lng = min(63.5 + rnd.randrange(4**10 + 1) * step, 99.5)
        assert encode(lat, lng) == _official_get_digipin(lat, lng), (lat, lng)


@pytest.mark.parametrize("lat,lng", [
    (38.5 - 9, 63.5 + 9),                    # a level-1 intersection
    (38.5 - 2.25 * 5, 63.5 + 2.25 * 6),      # level 2
    (38.5 - 0.5625 * 19, 63.5 + 0.5625 * 25),  # level 3
    (38.5 - 36 / 4**10 * 7777, 63.5 + 36 / 4**10 * 31),  # level 10
])
def test_a_coordinate_on_a_grid_line_goes_north_and_east(lat, lng):
    """§3.4, stated as the rule rather than as a code.

    "the location is assigned a DIGIPIN symbol of the adjoining right-side
    (eastward) grid, if it falls on a vertical grid line… the adjoining up-side
    (northward) grid… if it coincides with a horizontal grid line."

    So the cell a boundary coordinate lands in must have that coordinate as its
    SOUTHERN and WESTERN edge, not its northern or eastern one. Asserted through
    `decode`, because that is the property a caller can actually observe.
    """
    area = decode(encode(lat, lng))
    assert area.min_lat == pytest.approx(lat, abs=1e-12)
    assert area.min_lng == pytest.approx(lng, abs=1e-12)


@pytest.mark.parametrize("lat,lng,edge", [
    (38.5, 77.2, "the 38.5 N top line belongs to the cell below it"),
    (28.6, 99.5, "the 99.5 E right line belongs to the cell left of it"),
    (38.5, 99.5, "and the corner belongs to both"),
])
def test_the_two_edges_that_break_the_rule_break_it_the_way_the_document_says(
        lat, lng, edge):
    """§3.4's exception: there is no cell north of 38.5 N or east of 99.5 E, so
    those two lines go the other way. This is the half of the boundary rule that
    the official JS handles by accident on one axis and on purpose on the other,
    and it is the one an independent implementation gets wrong."""
    area = decode(encode(lat, lng))
    assert area.min_lat <= lat <= area.max_lat, edge
    assert area.min_lng <= lng <= area.max_lng, edge
    if lat == 38.5:
        assert area.max_lat == pytest.approx(38.5, abs=1e-12), edge
    if lng == 99.5:
        assert area.max_lng == pytest.approx(99.5, abs=1e-12), edge


# ══════════════════════════════════════════════════════════════════════════════
#  3 · round trip, both directions, and the measured precision
# ══════════════════════════════════════════════════════════════════════════════

def test_a_coordinate_round_trips_to_within_half_a_cell_and_never_further():
    """The precision claim in the module docstring, as an assertion.

    Half a cell is 1.716614e-05 deg. Measured worst case over these 20,000
    samples on 2026-08-28: 1.716612e-05 lat, 1.716614e-05 lng — the theoretical
    floor to five significant figures, i.e. ALL the error is "a cell is 3.8 m
    wide" and none of it is arithmetic loss.

    The upper bound is asserted at exactly half a cell rather than at some round
    number: a `Fraction` implementation that had been quietly replaced by a float
    one would still round-trip to about 2 m and would fail here.
    """
    rnd = random.Random(7)
    worst_lat = worst_lng = 0.0
    for _ in range(20_000):
        lat = rnd.uniform(2.5, 38.5)
        lng = rnd.uniform(63.5, 99.5)
        area = decode(encode(lat, lng))

        # The original coordinate is inside the cell it encoded to. Half-open,
        # so a point on the northern edge belongs to the cell above.
        assert area.min_lat <= lat < area.max_lat
        assert area.min_lng <= lng < area.max_lng

        worst_lat = max(worst_lat, abs(lat - area.centre_lat))
        worst_lng = max(worst_lng, abs(lng - area.centre_lng))

    assert worst_lat <= HALF_CELL_DEG
    assert worst_lng <= HALF_CELL_DEG
    # ~1.9 m of latitude. Stated in metres because that is the unit the claim
    # "~4 m grid" is made in, and the unit a customer will judge it in.
    assert worst_lat * 111_320 < 2.0


def test_every_code_survives_a_trip_through_coordinates_unchanged():
    """`encode(decode(code)) == code`, for 20,000 random level-10 codes.

    THE TEST THAT WOULD CATCH FLOAT SLOPPINESS AT THE TENTH LEVEL. The centre of
    a cell is 1.7e-05 deg from its nearest edge and a double near 38 N resolves
    to about 7e-15, so there are ~9 orders of magnitude of headroom — which is
    exactly why a drifting implementation still passes at level 6 and fails only
    on the last symbol or two. Codes are generated over the full 4**10 x 4**10
    index space, so level 10 is exercised on every single sample.
    """
    rnd = random.Random(99)
    for _ in range(20_000):
        code = _random_code(rnd)
        area = decode(code)
        assert encode(area.centre_lat, area.centre_lng) == code
        # And from the corners inward, not just the middle: a cell is closed at
        # its south-west corner, so that exact point must belong to this cell.
        assert encode(area.min_lat, area.min_lng) == code


def _random_code(rnd: random.Random) -> str:
    # Ten characters, no punctuation — the canonical form, so that
    # `encode(decode(code)) == code` compares like with like. Generating the
    # grouped spelling here would make the round-trip test fail on the
    # FORMATTING and hide whether the arithmetic round-tripped at all.
    symbols = [rnd.choice(rnd.choice(digipin.DIGIPIN_GRID)) for _ in range(10)]
    return "".join(symbols)


def test_the_decoded_centre_is_the_middle_of_the_decoded_bounds():
    """Trivial, and it is here because `centre_lat` is the field every caller
    will use and the bounds are the field none of them will check."""
    area = decode(DAK_BHAWAN_DIGIPIN)
    assert area.centre_lat == pytest.approx((area.min_lat + area.max_lat) / 2)
    assert area.centre_lng == pytest.approx((area.min_lng + area.max_lng) / 2)


def test_a_decoded_cell_is_an_area_of_about_four_metres_and_says_so():
    """POINT 3 IN THE MODULE DOCSTRING, ENFORCED BY THE TYPE.

    There is no `.lat` or `.lng` on `DigipinArea`, on purpose: a caller writing
    `area.lat` gets an `AttributeError` at the moment they make the mistake,
    rather than a number with 3.8 m of invented precision that reaches a distance
    calculation months later. This asserts the absence, because "we named it
    carefully" is not a guarantee — the next person adds a convenience alias.
    """
    area = decode(DAK_BHAWAN_DIGIPIN)

    assert not hasattr(area, "lat")
    assert not hasattr(area, "lng")
    assert not hasattr(area, "latitude")
    assert not hasattr(area, "longitude")

    assert area.max_lat > area.min_lat and area.max_lng > area.min_lng
    assert area.height_deg == pytest.approx(2 * HALF_CELL_DEG)
    assert area.width_deg == pytest.approx(2 * HALF_CELL_DEG)
    # The document's "3.8m x 3.8m" (§3.1) — as metres on the ground at Delhi.
    metres_ns = area.height_deg * 111_320
    metres_ew = area.width_deg * 111_320 * math.cos(math.radians(area.centre_lat))
    assert 3.5 < metres_ns < 4.0
    assert 3.0 < metres_ew < 3.6
    assert area.code == DAK_BHAWAN_DIGIPIN, "the area carries the code it came from"


# ══════════════════════════════════════════════════════════════════════════════
#  4 · refusal — out of the box, and not a number
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("lat,lng,place", [
    (25.2048, 55.2708, "Dubai — west of 63.5 E"),
    (39.9042, 116.4074, "Beijing — outside on both axes"),
    (39.0, 77.2, "just north of 38.5"),
    (2.4999, 77.2, "just south of 2.5"),
    (28.6, 63.4999, "just west of 63.5"),
    (28.6, 99.5001, "just east of 99.5"),
    (51.5074, -0.1278, "London"),
    (-33.8688, 151.2093, "Sydney"),
    (0.0, 0.0, "Null Island — the default a broken form submits"),
    (77.213033, 28.622788, "Dak Bhawan with lat and lng swapped"),
])
def test_a_coordinate_outside_india_is_refused_not_encoded(lat, lng, place):
    """THE REFUSAL THAT MATTERS MOST.

    Every one of these has ten perfectly plausible characters waiting for it if
    the implementation clamps or wraps instead of refusing, and nothing
    downstream could ever tell. Note the last two: `(0, 0)` is what an empty
    HTML form posts, and a swapped pair is what a caller who read `lng, lat`
    from GeoJSON passes — Dak Bhawan's own coordinates, reversed, are outside
    the box, so the swap is caught rather than silently mapped into Gujarat.
    """
    with pytest.raises(CoordinateOutOfRange):
        encode(lat, lng)
    assert encode_or_none(lat, lng) is None, place
    assert is_within_grid(lat, lng) is False, place


@pytest.mark.parametrize("lat,lng", [
    (2.5, 63.5), (38.5, 99.5), (2.5, 99.5), (38.5, 63.5),
    (28.622788, 77.213033), (8.4, 76.95), (34.08, 74.79),
])
def test_the_edges_of_the_box_are_inside_it(lat, lng):
    """The complement, and the reason the guard is `<=` on both ends: the box is
    CLOSED. An exclusive bound would refuse Kanyakumari-adjacent water and the
    two corners of the EEZ that §3.1 says the box exists to include."""
    assert is_within_grid(lat, lng) is True
    assert len(encode(lat, lng)) == 10   # ten symbols, no punctuation


@pytest.mark.parametrize("lat,lng,place", [
    (6.9271, 79.8612, "Colombo"),
    (34.5553, 69.2075, "Kabul"),
    (27.7172, 85.3240, "Kathmandu"),
    (23.8103, 90.4125, "Dhaka"),
    (10.0, 70.0, "open Arabian Sea"),
])
def test_the_box_is_a_rectangle_and_it_covers_more_than_india(lat, lng, place):
    """FOUND BY THIS TEST FAILING, AND IT IS A FACT ABOUT THE PRODUCT.

    The first draft of the test above listed Colombo and Kabul as "outside the
    grid". They are not: 63.5–99.5 E by 2.5–38.5 N is a RECTANGLE, chosen (§3.1)
    to contain all of India plus the maritime EEZ, and a rectangle that does that
    inevitably contains Sri Lanka, most of Nepal, Bangladesh, much of Pakistan
    and Afghanistan and a large amount of open ocean.

    So `encode()` answers a perfectly valid DIGIPIN for Colombo, and this test
    asserts that rather than hiding it. It is stated here because the alternative
    reading — "a DIGIPIN means the address is in India" — is the one a
    downstream feature will quietly assume ("clients near me", conveyance
    distance), and it is false. `is_within_grid` is named for the grid, not for
    the country, for the same reason.

    Refusing these would mean inventing a rule India Post did not write and
    shipping codes that disagree with every other implementation.
    """
    assert is_within_grid(lat, lng) is True, place
    code = encode(lat, lng)
    assert code == _official_get_digipin(lat, lng), place
    # And it is a real cell: it comes back to where it started.
    area = decode(code)
    assert area.min_lat <= lat < area.max_lat
    assert area.min_lng <= lng < area.max_lng


@pytest.mark.parametrize("bad", [
    float("nan"), float("inf"), float("-inf"),
])
def test_a_non_finite_coordinate_is_refused(bad):
    """NaN IS THE TRAP, AND IT IS NOT HYPOTHETICAL.

    `nan < 2.5` and `nan > 38.5` are both False, so the obvious range guard
    passes it straight through to the arithmetic. A NaN latitude is what a GNSS
    fix that never resolved serialises to, and `<AddressBlock>` is about to get a
    "drop a pin" affordance on a phone.
    """
    with pytest.raises(CoordinateOutOfRange):
        encode(bad, 77.2)
    with pytest.raises(CoordinateOutOfRange):
        encode(28.6, bad)
    assert is_within_grid(bad, 77.2) is False


@pytest.mark.parametrize("bad", ["28.6", None, [28.6], {"lat": 28.6}, True])
def test_a_coordinate_that_is_not_a_number_is_refused(bad):
    """Including `True`: `isinstance(True, int)` is True in Python, so a bare
    numeric check reads `encode(True, 77.2)` as latitude 1 — out of range here,
    but latitude 1 is inside plenty of other boxes and the habit is the bug."""
    with pytest.raises(CoordinateOutOfRange):
        encode(bad, 77.2)
    assert encode_or_none(bad, 77.2) is None


def test_an_integer_coordinate_is_accepted():
    """`28` from a JSON body that dropped its decimals is a real latitude, and
    the type check above must not have made it un-encodable."""
    assert encode(28, 77) == encode(28.0, 77.0)


def test_every_refusal_is_one_family_a_router_can_catch():
    """A router mapping this to a 422 catches `DigipinError` once. Both concrete
    classes must therefore be under it, and it must be a `ValueError` so that a
    caller who does not import this module still catches something sensible."""
    assert issubclass(CoordinateOutOfRange, DigipinError)
    assert issubclass(MalformedDigipin, DigipinError)
    assert issubclass(DigipinError, ValueError)


# ══════════════════════════════════════════════════════════════════════════════
#  5 · decode refuses too — case and hyphens, stated
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("written", [
    "39J49LL8T4",       # canonical - ten characters, no punctuation
    "39J-49L-L8T4",     # the grouped spelling, still accepted on input
    "39J49LL8T4",       # bare, as a database column might hold it
    "39j-49l-l8t4",     # lower case, as typed on a phone
    "39J 49L L8T4",     # spaces — how the technical document itself prints it
    "  39J-49L-L8T4 ",  # a paste with a trailing space
    "\t39J49LL8T4\n",   # a paste with a trailing newline
    "39J-49L L8T4",     # mixed separators
])
def test_the_accepted_spellings_all_normalise_to_one(written):
    """Case and hyphen handling, stated as a whitelist.

    The trailing-newline case is the same one `services/mappls.py` strips off a
    Railway variable: invisible in every console, fatal on comparison.
    """
    assert normalise(written) == DAK_BHAWAN_DIGIPIN
    assert decode(written).code == DAK_BHAWAN_DIGIPIN
    assert decode(written) == decode(DAK_BHAWAN_DIGIPIN)


@pytest.mark.parametrize("bad,why", [
    ("", "empty"),
    ("39J-49L-L8T", "nine symbols"),
    ("39J-49L-L8T44", "eleven symbols"),
    ("3-9J49LL8T4", "a hyphen in the wrong place"),
    ("39J-49LL8T4", "one hyphen missing"),
    ("39J49L-L8T4", "the other hyphen missing"),
    ("39J-49L-L8T4-", "a trailing hyphen"),
    ("-39J-49L-L8T4", "a leading hyphen"),
    ("39J--49L-L8T4", "a doubled hyphen"),
    ("39J–49L–L8T4", "en dashes out of a word processor"),
    ("39J_49L_L8T4", "underscores"),
    ("39J.49L.L8T4", "full stops"),
    ("39J-49L-L8T0", "0 — not a DIGIPIN symbol, and it looks like O"),
    ("39J-49L-L8TO", "O — not one either"),
    ("39I-49L-L8T4", "I — excluded for looking like 1"),
    ("39G-49L-L8T4", "G — a BETA-era symbol, replaced by C in the final version"),
    ("39W-49L-L8T4", "W — beta, replaced by F"),
    ("39X-49L-L8T4", "X — beta, replaced by T"),
    ("39J 49L L8T4 extra", "trailing words"),
    ("39J-49L-L8T4 39J-49L-L8T4", "two codes in one field"),
])
def test_a_malformed_code_is_refused(bad, why):
    """Every one of these is something a text field will receive.

    The three beta symbols matter more than they look: G, W and X were REAL
    DIGIPIN symbols in the beta grid and were replaced by C, F and T in the final
    version (§4). A beta-era code is not a typo — it is a valid code from an
    obsolete grid, and decoding it against this grid would return a confident
    location in the wrong place. Refusing is the only correct answer.
    """
    with pytest.raises(MalformedDigipin):
        normalise(bad)
    with pytest.raises(MalformedDigipin):
        decode(bad)


@pytest.mark.parametrize("bad", [None, 39, 3.9, ["39J", "49L", "L8T4"], b"39J49LL8T4"])
def test_a_code_that_is_not_a_string_is_refused(bad):
    """`b"39J49LL8T4"` is the one that would otherwise slip: bytes out of a
    driver or a cache have a `.upper()` and would sail through a duck-typed
    normaliser, then fail somewhere unrelated."""
    with pytest.raises(MalformedDigipin):
        decode(bad)


def test_the_error_message_names_the_symbol_that_is_wrong():
    """A refusal a person can act on. "not a DIGIPIN" sends somebody to re-read
    their whole code; naming the character sends them to the character."""
    with pytest.raises(MalformedDigipin, match="0"):
        decode("39J-49L-L8T0")


def test_normalise_is_idempotent():
    """Because its output is what gets stored, and a second pass over a stored
    value must not change it — otherwise two rows that hold the same cell stop
    comparing equal."""
    once = normalise("39j49ll8t4")
    assert normalise(once) == once == DAK_BHAWAN_DIGIPIN


# ══════════════════════════════════════════════════════════════════════════════
#  6 · no vendor, no network — the property the whole step is built on
# ══════════════════════════════════════════════════════════════════════════════

def test_the_module_reaches_no_network():
    """DIGIPIN IS IN THE PLAN *BECAUSE* IT COSTS NOTHING AND DEPENDS ON NOBODY.

    PHASE-8 §8.4: "encode/decode is pure arithmetic with no vendor and no API
    call". The moment somebody adds a lookup — an address search, a validation
    endpoint, a "verify this DIGIPIN" call — the step acquires a key, a quota, a
    licence and an outage mode, and none of that is visible in a diff that reads
    like a helpful improvement.

    Asserted against the source text, the same way `test_mappls_token.py` guards
    `services/mappls.py` after that module spent months calling an endpoint for a
    credential that turned out to be the wrong one. A source-text check is crude
    and it is the only kind that fails on the line that introduces the problem
    rather than on the day the quota runs out.
    """
    src = inspect.getsource(digipin)

    # Matched as IMPORT STATEMENTS, not as bare words. The first version of this
    # test asserted `"requests" not in src` and failed on the module's own
    # docstring, which names the thing it forbids — a check that cannot survive
    # its own documentation is a check somebody will delete rather than fix.
    assert "import httpx" not in src
    assert "import requests" not in src and "from requests" not in src
    for banned in ("import socket", "import urllib", "from urllib",
                   "import aiohttp", "import os", "import asyncpg",
                   "get_pool(", "import boto3", "import subprocess"):
        assert banned not in src, f"services/digipin.py reached for {banned}"


def test_the_module_holds_no_credential_and_needs_no_configuration():
    """No key, no env var, no `settings` import. A DIGIPIN computed on a laptop
    with no network is the same DIGIPIN as one computed on Railway — which is the
    difference between this and every other item in the map programme, and the
    reason §8.4 could ship while Phase 7 was still arguing with a licence."""
    src = inspect.getsource(digipin)

    assert "getenv" not in src
    assert "environ" not in src
    assert "API_KEY" not in src and "api_key" not in src


def test_encoding_is_a_pure_function_of_the_two_coordinates():
    """Same input, same answer, for ever — no clock, no cache, no state.

    This is what makes a stored DIGIPIN auditable: §8.4 requires `geo_source` and
    `geo_fetched_at` beside a coordinate precisely because a VENDOR's answer can
    change under you. This one cannot, so a stored code can always be re-derived
    from the coordinate it was made from and checked.
    """
    first = [encode(*DAK_BHAWAN) for _ in range(3)]
    assert first == [DAK_BHAWAN_DIGIPIN] * 3
    assert decode(DAK_BHAWAN_DIGIPIN) == decode(DAK_BHAWAN_DIGIPIN)


def test_the_grid_is_the_sixteen_final_version_symbols_and_no_others():
    """The alphabet, pinned. §3 lists the sixteen; §4 records that G, W and X
    were dropped. A grid holding seventeen symbols, or a duplicate, would still
    encode and decode — it would just be a different, wrong, addressing system."""
    flat = [ch for row in digipin.DIGIPIN_GRID for ch in row]

    assert len(flat) == 16
    assert len(set(flat)) == 16, "a duplicated symbol makes decoding ambiguous"
    assert set(flat) == set("23456789CFJKLMPT")
    assert set(flat).isdisjoint(set("01ABDEGHINOQRSUVWXYZ"))
    assert digipin.ALPHABET == set(flat)


def test_the_bounding_box_is_the_final_version_box():
    """§3.1, and §4's record that the beta box (63.5-99 E, 1.5-39 N) was changed.
    A module still carrying the beta box produces codes that are wrong
    everywhere, by an amount that varies with position — the hardest possible
    fault to spot from a sample."""
    assert (digipin.MIN_LAT, digipin.MAX_LAT) == (2.5, 38.5)
    assert (digipin.MIN_LNG, digipin.MAX_LNG) == (63.5, 99.5)
    assert digipin.MAX_LAT - digipin.MIN_LAT == digipin.MAX_LNG - digipin.MIN_LNG == 36
    assert digipin.LEVELS == 10
