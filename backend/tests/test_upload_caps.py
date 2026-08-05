"""Upload limits must bound MEMORY, not just storage.

Every upload path already had a size limit. Three of the four applied it after
`await file.read()` — after the whole body was resident in the worker. So a
500MB POST to the e-sign endpoint was 500MB of RSS before the 20MB check
rejected it, on a container with two gunicorn workers, an observed peak of
0.85GB and a 2GB ceiling. The limit bounded what was STORED. Nothing bounded
what was HELD.

`routers/uploads.py` was the one that did it correctly, reading in 1MB chunks
and abandoning mid-stream. That loop is now `storage.read_capped` and all four
paths use it.

WHAT THESE TESTS PIN, and why it is not the obvious thing: asserting "a big
upload returns 413" would pass against the OLD code too — it rejected, it just
rejected late. The assertion that distinguishes them is HOW MUCH WAS READ before
the refusal. `_Counting` records it.
"""
import pytest
from fastapi import HTTPException

from services import storage


class _Counting:
    """An UploadFile-ish object that records how many bytes it actually served."""

    def __init__(self, total: int, chunk_hint: int = 1024 * 1024):
        self.remaining = total
        self.served = 0
        self._hint = chunk_hint

    async def read(self, n: int = -1) -> bytes:
        take = self.remaining if n is None or n < 0 else min(n, self.remaining)
        self.remaining -= take
        self.served += take
        return b"\x00" * take


class _Stream:
    """A request-ish object whose body arrives in chunks."""

    def __init__(self, total: int, chunk: int = 1024 * 1024):
        self.total, self.chunk, self.served = total, chunk, 0

    async def stream(self):
        left = self.total
        while left > 0:
            n = min(self.chunk, left)
            left -= n
            self.served += n
            yield b"\x00" * n


LIMIT = 25 * 1024 * 1024


@pytest.mark.asyncio
async def test_an_oversized_upload_is_refused():
    f = _Counting(100 * 1024 * 1024)
    with pytest.raises(HTTPException) as e:
        await storage.read_capped(f, LIMIT, "25 MB")
    assert e.value.status_code == 413
    assert "25 MB" in e.value.detail


@pytest.mark.asyncio
async def test_it_stops_reading_instead_of_buffering_the_whole_body():
    """THE regression. The old code read all 400MB, then compared to 25MB."""
    f = _Counting(400 * 1024 * 1024)
    with pytest.raises(HTTPException):
        await storage.read_capped(f, LIMIT, "25 MB")

    # One chunk past the limit is enough to know; anything near the full body
    # means the guard is running after the damage.
    assert f.served <= LIMIT + 1024 * 1024, (
        f"read {f.served // (1024*1024)}MB before refusing a {LIMIT // (1024*1024)}MB limit — "
        "the check is bounding storage, not memory"
    )


@pytest.mark.asyncio
async def test_a_file_at_the_limit_is_allowed_through():
    """An off-by-one here rejects the largest legitimate upload."""
    out = await storage.read_capped(_Counting(LIMIT), LIMIT, "25 MB")
    assert len(out) == LIMIT


@pytest.mark.asyncio
async def test_the_bytes_are_returned_intact():
    """Chunked reading must reassemble exactly — a lossy cap is worse than none."""
    out = await storage.read_capped(_Counting(3 * 1024 * 1024 + 17), LIMIT)
    assert len(out) == 3 * 1024 * 1024 + 17


@pytest.mark.asyncio
async def test_an_empty_upload_reads_as_empty_rather_than_raising():
    """Callers check emptiness themselves and return 400, not 413."""
    assert await storage.read_capped(_Counting(0), LIMIT) == b""


@pytest.mark.asyncio
async def test_the_raw_body_path_is_capped_too():
    """
    e-sign accepts a bare PDF as the request body. That branch called
    `await request.body()`, which has no limit of any kind — the 20MB check sat
    underneath it and could only ever run once the bytes had arrived.
    """
    r = _Stream(200 * 1024 * 1024)
    with pytest.raises(HTTPException) as e:
        await storage.read_body_capped(r, 20 * 1024 * 1024, "20 MB")
    assert e.value.status_code == 413
    assert r.served <= 21 * 1024 * 1024, "the raw stream was drained before refusing"


@pytest.mark.asyncio
async def test_a_small_raw_body_passes():
    assert len(await storage.read_body_capped(_Stream(512 * 1024), 20 * 1024 * 1024)) == 512 * 1024


def test_the_default_label_is_readable_when_a_caller_gives_none():
    assert storage._mb(25 * 1024 * 1024) == "25 MB"
    assert storage._mb(4 * 1024 * 1024) == "4 MB"
