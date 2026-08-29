"""A refusal must name a size a file could actually be under.

Found 2026-08-29 while sizing proposal 93 §5's oversize fixture against the real
constants. `services/storage._mb` was `f"{n // (1024 * 1024)} MB"`, so every
limit below a megabyte rendered as **0 MB** and the 413 read:

    File exceeds the 0 MB limit

That is not a cosmetic string. It is a refusal naming a size no file can be
under, given to somebody who now has no way to work out what was wanted. It bit
Pahchan's 768 KB punch-photo cap, whose own call site names *"a site worker's
phone on a bad network"* as the likeliest source of an oversized upload — so it
was the message that path exists to produce, and it had never been read back.

⚠ THE POINT OF THIS FILE IS THE SUB-MEGABYTE CASE. `test_upload_caps.py` covers
`read_capped`'s behaviour and passes a 25 MB label explicitly, so it could not
have caught this: every limit it exercises is comfortably over a megabyte, and
the default label is the arm that was broken.
"""
import re

import pytest

from routers import pahchan
from services import storage


@pytest.mark.parametrize(
    "size,expected",
    [
        (768 * 1024, "768 KB"),          # Pahchan's punch photo — the one that bit
        (10 * 1024 * 1024, "10 MB"),     # uploads.MAX_BYTES — the common case, unchanged
        (25 * 1024 * 1024, "25 MB"),     # the video cap
        (1024 * 1024, "1 MB"),           # exactly on the boundary
        (1024 * 1024 - 1, "1023 KB"),    # one byte under it
        (1024, "1 KB"),
        (999, "999 bytes"),              # below a kilobyte, and it must not say "0 KB"
        (0, "0 bytes"),
    ],
)
def test_a_limit_is_named_in_a_unit_that_can_hold_it(size, expected):
    assert storage._mb(size) == expected


def test_no_limit_ever_renders_as_zero_of_a_unit():
    """The general form of the defect, across every real limit in the product.

    A number-plus-unit that reads `0` is the failure, whatever the unit — so
    this asserts the SHAPE rather than a list of expected strings, and would
    catch a future `_mb` that rounded to `0 KB` on a 500-byte cap.
    """
    limits = [
        pahchan.MAX_PHOTO_BYTES,
        768 * 1024, 512 * 1024, 100 * 1024, 10 * 1024 * 1024, 25 * 1024 * 1024,
    ]
    for n in limits:
        rendered = storage._mb(n)
        assert not re.match(r"^0\s", rendered), (
            f"{n} bytes renders as {rendered!r} — a refusal naming a size no "
            "file can be under"
        )


def test_pahchans_photo_cap_is_not_described_in_megabytes():
    """The call site, not just the helper.

    `pahchan.py` passes its own label rather than using the default, so fixing
    `_mb` alone would have left this one reading "0MB photo". Both were wrong
    and both are fixed; this pins the call site so they cannot drift apart.
    """
    import inspect

    src = inspect.getsource(pahchan)
    assert "MAX_PHOTO_BYTES // (1024 * 1024)" not in src, (
        "the punch-photo 413 is back to integer-dividing 768 KB by a megabyte, "
        "which is 0"
    )
    assert 'f"{MAX_PHOTO_BYTES // 1024}KB photo"' in src
