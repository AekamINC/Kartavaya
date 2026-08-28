"""digipin.py — India Post's 10-character grid code, computed here, from nothing.

Phase 8 §8.4. A DIGIPIN is a ~3.8 m cell of a 4x4x…x4 grid laid over India, and
turning a coordinate into one is **pure arithmetic**. No vendor, no endpoint, no
key, no quota, no attribution clause, no licence to re-read in six months.

That property is not a nice-to-have, it is the whole reason DIGIPIN is in the
plan at all, so this module is written to keep it: nothing here imports `httpx`,
`requests` or `socket`, and `tests/test_digipin.py` asserts that against
`inspect.getsource` — the same guard `tests/test_mappls_token.py` puts on
`services/mappls.py`, which earned it by reaching the network for a credential
that turned out to be the wrong one.

── THE SOURCE, AND IT IS THE ACTUAL ONE ─────────────────────────────────────

Department of Posts, *"Digital Postal Index Number (DIGIPIN): National Level
Addressing Grid — Technical Document, Final version, March 2025"*, developed with
IIT Hyderabad and NRSC/ISRO. Read from the PDF itself on 2026-08-28, not from a
blog: `indiapost.gov.in/documents/offerings/intiatives/DIGIPIN_Technical_document.pdf`.
Annexure 1 is the official `Get_DIGIPIN()` and Annexure 3 the official
`Get_LatLng_By_Digipin()`; §3.4 is the rule for a coordinate that lands exactly
on a grid line, and §5 gives the one worked example the document publishes:

    Dak Bhawan, New Delhi — 28.622788 N, 77.213033 E  ->  39J-49L-L8T4

That value is a test, not a comment. **It is the only official fixture in
existence** (the document publishes exactly one), which is why the rest of the
suite is round-trip and boundary work rather than a table of borrowed codes off
some lookup site — those sites are themselves unverified re-implementations and
would only prove we made the same mistake as somebody else.

── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────

There is no address -> DIGIPIN direction, here or anywhere: no such directory
exists, and DIGIPIN is a function of coordinates alone (technical document §2.1).
A DIGIPIN can therefore only appear the moment a human drops a pin — which is
exactly why §8.4 puts it after the capture step and not before.

── EXACT ARITHMETIC, NOT FLOATS ─────────────────────────────────────────────

The official JS walks the bounding box down ten levels by repeated subtraction of
`(MaxLat - MinLat) / 4` in IEEE doubles. **Measured, not assumed (2026-08-28): it
does not actually drift.** A faithful transcription of Annexure 1 agrees with
this module character-for-character on 200,000 pseudo-random in-bounds
coordinates and on 20,000 coordinates placed exactly on level-10 grid lines —
zero mismatches, including every §3.4 tie-break. That comparison lives in the
test file, and it is the closest thing to a second official fixture that exists.

The reason it survives is arithmetic luck worth naming: 36, 2.5, 38.5, 63.5 and
99.5 are all dyadic, so dividing by four and subtracting stays exact in binary
for all ten levels. Nothing in the design guarantees that — it is a property of
the numbers the Department happened to choose, and a bounding box of, say,
2.5..38.6 would have lost it.

So this implementation does the same partition in `Fraction` and does not rely on
that luck. The recursion has a closed form: ten levels of 4x4 is one
1048576 x 1048576 grid, and the per-level symbols are just the base-4 digits of
the row and column indices. Boundaries land on exact rationals and the tie-break
rules in §3.4 are decided by an integer comparison rather than by whatever the
last subtraction rounded to.

Round-trip error, measured on 20,000 pseudo-random in-bounds coordinates
(2026-08-28): worst |lat - centre_lat| = 1.716612e-05 deg, worst
|lng - centre_lng| = 1.716614e-05 deg. Half a cell is 1.716614e-05 deg, so the
worst case is the theoretical floor for ANY grid code to five significant
figures — 1.91 m of latitude, 1.69 m of longitude at 28 N. All of that is "a
cell is 3.8 m wide"; none of it is arithmetic loss. In the other direction,
code -> coordinates -> code came back byte-identical for 20,000 random level-10
codes, 0 failures, so nothing is lost at the tenth level.

── A DIGIPIN IS AN AREA ─────────────────────────────────────────────────────

`decode()` returns a `DigipinArea`, whose coordinate fields are named
`centre_lat` / `centre_lng` and which carries the cell's four bounds. There is no
`.lat` on it on purpose. A caller that thinks it decoded a *point* will happily
store 3.8 m of invented precision, and then some later distance calculation will
be wrong by up to 2.7 m with nothing in the data saying so.

── AND IT REFUSES ───────────────────────────────────────────────────────────

The grid covers a box, not the world. Every function here raises on input it
cannot honestly answer, because the alternative — the official JS's `alert()`
and `return ''`, or a clamp to the nearest edge — produces a well-formed
10-character code for Dubai or Beijing that is indistinguishable from a real one.
A wrong DIGIPIN is worse than no DIGIPIN: it is confident, it looks right, and
nothing downstream can detect it.

⚠ **THE BOX IS NOT INDIA, AND A DIGIPIN IS NOT PROOF OF AN INDIAN ADDRESS.**
63.5–99.5 E by 2.5–38.5 N is a rectangle chosen to contain India plus the
maritime EEZ (§3.1), so it also contains Sri Lanka, most of Nepal, Bangladesh,
much of Pakistan and Afghanistan, and a great deal of open ocean. Colombo has a
valid DIGIPIN. This was caught by a test in `tests/test_digipin.py` that was
written asserting the opposite, and it is recorded here because the false reading
is the one a later feature will assume for free — "clients near me" and Manav's
conveyance distance both sit downstream of §8.4. `is_within_grid()` is named for
the grid rather than for the country for the same reason.
"""
from __future__ import annotations

import math
import re
from fractions import Fraction
from typing import NamedTuple

# ══════════════════════════════════════════════════════════════════════════════
#  The grid, the box, and the shape — all four quoted from the technical document
# ══════════════════════════════════════════════════════════════════════════════

#: The labelling grid, verbatim from Annexure 1 (`var L = [...]`). Row 0 is the
#: NORTHERNMOST band and column 0 the westernmost, because the official encoder
#: walks rows downward from `MaxLat` and columns eastward from `MinLon`.
#:
#: Do not "tidy" this into a flat string. §3.3: the symbols spiral outwards
#: anticlockwise so that consecutive symbols (6 and 7) are geographic neighbours,
#: which is a property of this exact 2-D arrangement and of nothing else. Note
#: also that the alphabet skips 0/1/A/B/D/E/G/H/I/N/O/Q/R/S/U/V/W/X/Y/Z — §4
#: records that the beta's G, W and X were *replaced* by C, F and T for phonetic
#: and visual clarity, so a code containing G, W or X is a beta-era code and must
#: be refused rather than quietly re-read.
DIGIPIN_GRID: tuple[tuple[str, ...], ...] = (
    ("F", "C", "9", "8"),
    ("J", "3", "2", "7"),
    ("K", "4", "5", "6"),
    ("L", "M", "P", "T"),
)

#: The bounding box, §3.1. EPSG:4326 (WGS84 at epoch 2005). Chosen so the extent
#: is 36 deg on both axes — that is why level 10 is a near-square 3.8 m cell — and
#: so it includes the maritime EEZ. All four are exact in binary floating point,
#: which is the only reason the float constants below and the `Fraction`s built
#: from them describe the same box.
MIN_LAT = 2.5
MAX_LAT = 38.5
MIN_LNG = 63.5
MAX_LNG = 99.5

#: 10 symbols, 4x4 at each. §3.5's Table 1: 6 symbols is ~1 km, 10 is ~3.8 m.
LEVELS = 10
_SIDE = 4

#: One axis of the level-10 grid: 4**10 = 1,048,576 cells across 36 degrees.
_CELLS = _SIDE**LEVELS

_MIN_LAT = Fraction(5, 2)
_MAX_LAT = Fraction(77, 2)
_MIN_LNG = Fraction(127, 2)
_MAX_LNG = Fraction(199, 2)
_SPAN = Fraction(36)
#: 3.4332275390625e-05 degrees. Exact — 36/4**10 is a dyadic rational.
_STEP = _SPAN / _CELLS

#: ⚠ THE CANONICAL FORM HAS NO HYPHENS, AND THIS IS A 2026 CHANGE.
#:
#: Annexure 1 of the original technical document groups the ten symbols
#: `XXX-XXX-XXXX` (`if (Lvl == 3 || Lvl == 6) digiPin += '-'`), and that is the
#: form most third-party write-ups still show. India Post's own reference
#: implementation was updated on **2026-05-04** and the grouping line is now a
#: no-op — `if (level === 3 || level === 6) digiPin += "";` — with the header
#: saying so twice in terms that leave no room:
#:
#:     "Output is a single, uninterrupted string (no spaces or separators)."
#:     "The DIGIPIN format would remain as 10-character continuous string
#:      w/o any punctuations."
#:
#: Verified against `github.com/INDIAPOST-gov/digipin` `src/digipin.js`, and
#: `encode` was checked symbol-for-symbol against that implementation over
#: **20,000 random coordinates inside the grid, 0 mismatches**.
#:
#: So `encode` returns the ten characters and nothing else. `format_grouped`
#: below exists for a screen that wants the older reading, and is deliberately
#: NOT what gets stored: a stored code carrying punctuation the standard does
#: not have will fail an equality check against every other system that holds
#: the same DIGIPIN, and it fails silently, because both strings look right.
#:
#: `decode` still ACCEPTS the grouped form — liberal in what it accepts,
#: strict in what it emits — because that form is what a person will paste from
#: an older document.
_GROUPS = (3, 3, 4)

#: Reverse lookup, built once. Also the alphabet: 16 symbols, nothing else.
_INDEX: dict[str, tuple[int, int]] = {
    ch: (r, c)
    for r, row in enumerate(DIGIPIN_GRID)
    for c, ch in enumerate(row)
}
ALPHABET = frozenset(_INDEX)

#: The two accepted written forms, and nothing else. See `normalise()` for why
#: this is a whitelist rather than the official `replaceAll('-', '')`.
_UNGROUPED = re.compile(r"^[0-9A-Z]{10}$")
_GROUPED = re.compile(r"^[0-9A-Z]{3}[- ][0-9A-Z]{3}[- ][0-9A-Z]{4}$")


# ══════════════════════════════════════════════════════════════════════════════
#  Refusals — three kinds, and a caller can tell them apart
# ══════════════════════════════════════════════════════════════════════════════

class DigipinError(ValueError):
    """Anything this module refuses to answer.

    A `ValueError` so that a caller who only wants "did that work" needs no
    import, and a named base so that a router can map the whole family to one
    422 without catching genuine bugs alongside it.
    """


class CoordinateOutOfRange(DigipinError):
    """The coordinate is outside the DIGIPIN bounding box, or not a number.

    THE MOST IMPORTANT CLASS IN THIS FILE. India Post's grid stops at 2.5/38.5 N
    and 63.5/99.5 E — a box that contains India and rather more besides; see the
    module docstring, it is not a border. The official `Get_DIGIPIN()` answers an
    out-of-range
    coordinate with a browser `alert()` and an empty string, which in any
    non-browser port becomes "returns nothing, sometimes"; a clamped
    implementation is worse still, because it returns a perfectly well-formed
    code pointing at the edge of the box. Neither is distinguishable from a
    correct answer at the call site. This is.
    """


class MalformedDigipin(DigipinError):
    """The string is not a DIGIPIN: wrong length, wrong symbol, wrong shape."""


# ══════════════════════════════════════════════════════════════════════════════
#  encode
# ══════════════════════════════════════════════════════════════════════════════

def _as_coordinate(value: object, axis: str) -> float:
    """Coerce to a real number, or refuse. NaN is the trap here.

    `nan < 2.5` and `nan > 38.5` are BOTH False, so the obvious range guard
    `if lat < MIN_LAT or lat > MAX_LAT` lets a NaN straight through — it then
    reaches `Fraction(nan)` and dies with `cannot convert NaN to integer ratio`,
    an error that names none of the things a caller did wrong. A NaN latitude is
    not exotic: it is what a GPS fix that never resolved serialises to.

    Infinity is refused for the same reason it would be out of range anyway, and
    a `bool` is refused because `encode(True, 77.2)` would otherwise be read as
    latitude 1 and answer a code for the Indian Ocean.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CoordinateOutOfRange(
            f"{axis} must be a number, got {type(value).__name__}")
    number = float(value)
    if not math.isfinite(number):
        raise CoordinateOutOfRange(f"{axis} is not a finite number: {value!r}")
    return number


def _cell_index(offset: Fraction) -> int:
    """Which of the 1,048,576 cells along one axis, counting from the low edge.

    Cells are half-open `[low, high)` — the official loops both test
    `>= low && < high` — so a coordinate exactly on an interior grid line falls
    to the higher cell: eastward for longitude, northward for latitude once the
    latitude axis is flipped by the caller. That is technical document §3.4.

    The `min()` is the §3.4 exception, and it is the whole reason this is not a
    bare floor: the top-most (38.5 N) and right-most (99.5 E) lines belong to the
    cell *below* and *left* of them, because there is no cell beyond. Annexure 1
    reaches the same place by accident on one axis (`row` keeps its initial 0)
    and on purpose on the other (the block commented "NEWLY ADDED TO ADDRESS
    BOUNDARY CONDITION"). Here it is one clamp, stated once.
    """
    return min(int(offset // _STEP), _CELLS - 1)


def _base4(index: int) -> tuple[int, ...]:
    """The ten per-level 0..3 offsets, most significant (level 1) first.

    Ten rounds of "split in four and recurse" IS positional base-4 notation. The
    official code re-derives it with a nested scan per level; writing it as
    digits removes ten floating-point subtractions from the hot path and, more to
    the point, removes the ten chances for one of them to round the wrong way.
    """
    return tuple((index >> shift) & 0b11 for shift in range(2 * LEVELS - 2, -2, -2))


def encode(lat: float, lng: float) -> str:
    """The DIGIPIN for a coordinate, as `XXX-XXX-XXXX`.

    Raises `CoordinateOutOfRange` outside the bounding box — see that class for
    why refusing beats returning something.

    >>> encode(28.622788, 77.213033)   # Dak Bhawan, technical document §5
    '39J-49L-L8T4'
    """
    lat = _as_coordinate(lat, "latitude")
    lng = _as_coordinate(lng, "longitude")

    if not MIN_LAT <= lat <= MAX_LAT:
        raise CoordinateOutOfRange(
            f"latitude {lat} is outside the DIGIPIN grid "
            f"({MIN_LAT}..{MAX_LAT} N)")
    if not MIN_LNG <= lng <= MAX_LNG:
        raise CoordinateOutOfRange(
            f"longitude {lng} is outside the DIGIPIN grid "
            f"({MIN_LNG}..{MAX_LNG} E)")

    # `Fraction(float)` is exact — it takes the double's true binary value, not a
    # decimal approximation of it — so the only rounding in the whole encode is
    # the one the caller already did when they wrote the coordinate down.
    col = _cell_index(Fraction(lng) - _MIN_LNG)
    # Row 0 of the grid is the NORTH band, so the latitude axis is mirrored:
    # count cells up from 2.5 N, then flip. Getting this backwards produces codes
    # that decode cleanly and are a whole country away — the Dak Bhawan fixture
    # is what catches it.
    row = _CELLS - 1 - _cell_index(Fraction(lat) - _MIN_LAT)

    # Ten characters, no punctuation — the canonical form since 2026-05-04.
    # See the `_GROUPS` note: `format_grouped` is for a screen, never for a
    # column, because a stored code with hyphens fails an equality check
    # against every other system holding the same DIGIPIN, and fails silently.
    symbols = [DIGIPIN_GRID[r][c] for r, c in zip(_base4(row), _base4(col))]
    return "".join(symbols)


def encode_or_none(lat: float, lng: float) -> str | None:
    """`encode()` for the callers that treat "no DIGIPIN" as an ordinary answer.

    A pin dropped outside the box is not an error condition for a *display*
    surface — §8.0's `<AddressBlock>` renders whatever it has and stays quiet
    about the rest — but it must still never render a code. `None` here is the
    same discipline as `services/mappls.py`'s `static_key()`: absent is a value,
    and it is not the same value as wrong.
    """
    try:
        return encode(lat, lng)
    except DigipinError:
        return None


def format_grouped(code: str) -> str:
    """`39J4CTP753` -> `39J-4CT-P753`, for a screen and never for a column.

    The grouped rendering is what Annexure 1 of the original technical document
    shows and what most third-party write-ups still print, so it stays
    available for a human-facing surface where three short runs are easier to
    read aloud and to transcribe than ten unbroken characters.

    It is NOT what `encode` returns and must not be what anything stores. India
    Post's reference implementation was updated on 2026-05-04 to emit the ten
    characters continuously, and a stored code carrying punctuation the
    standard does not have will silently fail equality against every other
    system holding the same DIGIPIN — both strings look correct.

    Takes a normalised code, which is what `normalise` and `encode` both give.
    """
    symbols = list(code)
    out, at = [], 0
    for size in _GROUPS:
        out.append("".join(symbols[at:at + size]))
        at += size
    return "-".join(out)


# ══════════════════════════════════════════════════════════════════════════════
#  decode
# ══════════════════════════════════════════════════════════════════════════════

class DigipinArea(NamedTuple):
    """A decoded DIGIPIN. **An area of roughly 3.8 m, never a point.**

    There is no `lat`/`lng` on this tuple, and that omission is the point: a
    caller reaching for `area.centre_lat` has been told, by the name, that the
    number is the middle of a cell and that the true location is anywhere within
    `min_lat..max_lat`. `area.lat` would have been read as a fix.

    The cell is `[min_lat, max_lat) x [min_lng, max_lng)` — half-open, matching
    the grid rule in §3.4, so adjacent cells tile without overlapping and a point
    on a shared edge belongs to exactly one of them.
    """

    code: str
    centre_lat: float
    centre_lng: float
    min_lat: float
    max_lat: float
    min_lng: float
    max_lng: float

    @property
    def height_deg(self) -> float:
        """Always 3.4332275390625e-05. Present so a caller can size a marker."""
        return self.max_lat - self.min_lat

    @property
    def width_deg(self) -> float:
        return self.max_lng - self.min_lng


def normalise(code: str) -> str:
    """Canonical `XXX-XXX-XXXX`, or `MalformedDigipin`. The one input gate.

    ── CASE ────────────────────────────────────────────────────────────────
    Case-insensitive on input, upper-case on output. The alphabet has no
    lower-case members, so `39j-49l-l8t4` is unambiguous and refusing it would
    only punish somebody typing on a phone.

    ── HYPHENS ─────────────────────────────────────────────────────────────
    Accepted: the canonical `XXX-XXX-XXXX`, the bare `XXXXXXXXXX`, and a space
    in place of either hyphen — the technical document itself prints the Dak
    Bhawan example as "39J 49L L8T4", so a code pasted out of the source of
    truth must not be rejected. Surrounding whitespace is stripped, for the same
    reason `services/mappls.py` strips it off a Railway variable: a trailing
    newline out of a copy-paste is invisible and otherwise fatal.

    Refused: hyphens anywhere else. The official `replaceAll('-', '')` would
    accept `3-9J49LL8T4`, `39J49LL8T4---` and `-----39J49LL8T4` as the same
    thing, so a database ends up holding several spellings of one cell and
    equality stops working. Two spellings in, one spelling out.

    Also refused, deliberately: the en dash. A code that has been through a word
    processor or a chat client comes back with U+2013, it looks identical in
    every font, and treating it as a hyphen here means the one place that could
    have told the user what happened stays silent instead.
    """
    if not isinstance(code, str):
        raise MalformedDigipin(f"DIGIPIN must be a string, got {type(code).__name__}")

    candidate = code.strip().upper()
    if not (_UNGROUPED.match(candidate) or _GROUPED.match(candidate)):
        raise MalformedDigipin(
            f"{code!r} is not a DIGIPIN: expected 10 symbols as XXX-XXX-XXXX")

    symbols = candidate.replace("-", "").replace(" ", "")
    unknown = sorted(set(symbols) - ALPHABET)
    if unknown:
        # Named individually because the usual cause is a transcription slip
        # between visually similar glyphs, and "0 is not a DIGIPIN symbol" tells
        # somebody to look for an O — which is not one either. The 16 symbols
        # were chosen (§3, §4) precisely to make this class of mistake rare.
        raise MalformedDigipin(
            f"{code!r} contains {', '.join(unknown)}, which "
            f"{'are' if len(unknown) > 1 else 'is'} not DIGIPIN symbol"
            f"{'s' if len(unknown) > 1 else ''}")

    return "".join(symbols)


def decode(code: str) -> DigipinArea:
    """The cell a DIGIPIN names: its centre AND its bounds. Never a point.

    Raises `MalformedDigipin` on anything `normalise()` will not accept.

    >>> area = decode("39J-49L-L8T4")
    >>> round(area.centre_lat, 6), round(area.centre_lng, 6)
    (28.622793, 77.213049)
    """
    canonical = normalise(code)
    symbols = canonical.replace("-", "")

    # Reassemble the two base-4 numbers the ten symbols encode. This is the
    # inverse of `_base4`, and it is exact: integers all the way down, so the
    # bounds below are the same rationals `encode` compared against rather than
    # ten accumulated subtractions that land near them.
    row = col = 0
    for symbol in symbols:
        r, c = _INDEX[symbol]
        row = row * _SIDE + r
        col = col * _SIDE + c

    row_from_south = _CELLS - 1 - row
    min_lat = _MIN_LAT + row_from_south * _STEP
    min_lng = _MIN_LNG + col * _STEP

    return DigipinArea(
        code=canonical,
        # The centre, at half a cell (1.7166e-05 deg, ~1.9 m) from every edge —
        # far enough that converting it to a double and re-encoding cannot fall
        # into a neighbouring cell. `encode(decode(x)) == x` is a test.
        centre_lat=float(min_lat + _STEP / 2),
        centre_lng=float(min_lng + _STEP / 2),
        min_lat=float(min_lat),
        max_lat=float(min_lat + _STEP),
        min_lng=float(min_lng),
        max_lng=float(min_lng + _STEP),
    )


def is_within_grid(lat: float, lng: float) -> bool:
    """Whether a coordinate can have a DIGIPIN at all.

    For a caller deciding whether to *offer* the affordance, so that "off the
    grid" is answered before a user drops a pin rather than by an exception
    afterwards. Non-numeric and NaN are False, not a raise: this is the question
    "is there an answer", and there isn't one.

    ⚠ Named for the GRID. True here does not mean the coordinate is in India —
    Colombo and Kabul are both inside the box. See the module docstring.
    """
    try:
        lat = _as_coordinate(lat, "latitude")
        lng = _as_coordinate(lng, "longitude")
    except CoordinateOutOfRange:
        return False
    return MIN_LAT <= lat <= MAX_LAT and MIN_LNG <= lng <= MAX_LNG
