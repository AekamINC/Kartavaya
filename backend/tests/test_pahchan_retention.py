"""
Pahchan retention — the promise that photographs of employees' faces are deleted.

07-pahchan.md §5 sets three independent windows: punch selfies at 90 days,
reference photos at employment + 45, punch records at 3 years. "Deleted means
deleted, not archived to cold storage."

These tests exist because the failure mode here is silent. A retention job that
logs a success while not keeping up does not look broken from the outside — it
manufactures a record of compliance, which is worse than failing loudly. The
drain test below is the one that matters: before it, a single BATCH slice per
daily run meant the break-even was 250 employees, and every org above that
retained selfies past 90 days forever while the log said `photos_deleted: 500`
every morning.
"""
from unittest.mock import AsyncMock

import pytest

import db
from services import pahchan_retention as R


def _rows(n, start=0, key="photo_key"):
    """n eligible rows, each with a distinct object key."""
    return [
        {"id": f"00000000-0000-0000-0000-{i:012d}", "org_id": "org-1", key: f"k{i}"}
        for i in range(start, start + n)
    ]


class _DrainPool:
    """
    A pool whose eligible set SHRINKS as rows are deleted, like the real one.

    `photo_key` is NULLed on success, so a deleted row leaves the result set;
    a row whose object delete failed keeps its key and stays. That is exactly
    the condition the OFFSET in the drain loop exists to handle, and getting it
    wrong is an infinite loop rather than a wrong number.
    """

    def __init__(self, total, key="photo_key", fail_keys=()):
        self.remaining = _rows(total, key=key)
        self.key = key
        self.fail_keys = set(fail_keys)
        self.statements = 0
        self.execute = AsyncMock(side_effect=self._delete)

    async def fetch(self, sql, *args):
        self.statements += 1
        # Parse the LIMIT/OFFSET the job interpolated, and honour them.
        limit = int(sql.split("LIMIT")[1].split()[0])
        offset = int(sql.split("OFFSET")[1].split()[0]) if "OFFSET" in sql else 0
        return self.remaining[offset:offset + limit]

    async def _delete(self, sql, *args):
        rid = args[0]
        self.remaining = [r for r in self.remaining if r["id"] != rid]
        return "DELETE 1"


@pytest.fixture(autouse=True)
def _no_real_storage(monkeypatch):
    """Never touch a bucket. Deletion is confirmed by default."""
    async def _ok(key, org_id=None):
        return True
    monkeypatch.setattr(R.storage, "delete_file", _ok)


@pytest.fixture
def pool(monkeypatch):
    def _install(p):
        monkeypatch.setattr(db, "_pool", p, raising=False)

        async def _get_pool():
            return p
        monkeypatch.setattr(R, "get_pool", _get_pool)
        return p
    return _install


# ── The drain ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_punch_photos_drain_beyond_one_batch(pool):
    """
    More than BATCH rows are deleted in a SINGLE run.

    This is the regression that matters. With a single slice per run, an org of
    500 employees produced 1000 expired selfies a day and the job deleted 500 —
    a permanent, silent, growing backlog of retained biometric data.
    """
    total = R.BATCH * 3 + 17
    p = pool(_DrainPool(total))

    out = await R.purge_punch_photos()

    assert out["photos_deleted"] == total, "a run must drain, not take one slice"
    assert out["photos_failed"] == 0
    assert out["photos_drained"] is True
    assert p.statements > 1, "draining means more than one statement"


@pytest.mark.asyncio
async def test_drain_stops_at_the_per_run_ceiling_and_says_so(pool, monkeypatch):
    """The ceiling still bounds a run — and an incomplete pass reports it."""
    monkeypatch.setattr(R, "MAX_PER_RUN", R.BATCH * 2)
    p = pool(_DrainPool(R.BATCH * 5))

    out = await R.purge_punch_photos()

    assert out["photos_deleted"] == R.BATCH * 2
    # The signal that the promise is NOT being kept. Without this an
    # over-capacity tenant is indistinguishable from a clean run.
    assert out["photos_drained"] is False


@pytest.mark.asyncio
async def test_failed_object_deletes_terminate_rather_than_loop(pool, monkeypatch):
    """
    Every object delete fails.

    A failed delete deliberately KEEPS `photo_key`, so the row stays eligible.
    Without the OFFSET those same rows are re-fetched forever and the daily job
    never returns. Termination is the assertion; the count is secondary.
    """
    async def _always_fail(key, org_id=None):
        return False
    monkeypatch.setattr(R.storage, "delete_file", _always_fail)
    monkeypatch.setattr(R, "MAX_PER_RUN", R.BATCH * 4)

    p = pool(_DrainPool(R.BATCH * 2))
    out = await R.purge_punch_photos()

    assert out["photos_deleted"] == 0
    assert out["photos_failed"] == R.BATCH * 2
    assert out["photos_drained"] is True, "the eligible set was exhausted, not abandoned"


@pytest.mark.asyncio
async def test_unconfirmed_delete_keeps_the_pointer(pool, monkeypatch):
    """
    A failed object delete must NOT clear photo_key.

    Clearing it would strand the object in the bucket with nothing left that
    knows where it is — the one outcome that makes the promise permanently
    unkeepable rather than merely late.
    """
    async def _always_fail(key, org_id=None):
        return False
    monkeypatch.setattr(R.storage, "delete_file", _always_fail)

    p = pool(_DrainPool(3))
    await R.purge_punch_photos()

    p.execute.assert_not_called()


# ── Independence of the three classes ────────────────────────────────────────

@pytest.mark.asyncio
async def test_punch_photo_purge_never_deletes_the_record(pool):
    """
    §5: the classes are independent, and §8: the record outlives the photo BY LAW.

    Deleting the selfie must NULL the key and leave the attendance row — hours
    worked is a payroll fact and the photo was only ever evidence. A cascade here
    would destroy pay records to honour a photo-retention promise.
    """
    p = pool(_DrainPool(4))
    await R.purge_punch_photos()

    assert p.execute.await_count == 4
    for call in p.execute.await_args_list:
        sql = call.args[0]
        assert "UPDATE staging.pahchan_punches" in sql
        assert "photo_key = NULL" in sql
        assert "DELETE" not in sql.upper()


@pytest.mark.asyncio
async def test_record_purge_deletes_the_photo_before_the_row(pool, monkeypatch):
    """
    §5's orphan case. Dropping the row while the object survives leaves a face in
    a bucket that nothing references and no future job can find.
    """
    seen = []

    async def _track(key, org_id=None):
        seen.append(key)
        return True
    monkeypatch.setattr(R.storage, "delete_file", _track)

    p = pool(_DrainPool(3))
    out = await R.purge_punch_records()

    assert out["records_deleted"] == 3
    assert seen == ["k0", "k1", "k2"], "the object goes first, every time"
    for call in p.execute.await_args_list:
        assert "DELETE FROM staging.pahchan_punches" in call.args[0]


@pytest.mark.asyncio
async def test_record_purge_keeps_the_row_when_the_photo_will_not_delete(pool, monkeypatch):
    """A punch record is cheap; an orphaned photograph of a face is not."""
    async def _always_fail(key, org_id=None):
        return False
    monkeypatch.setattr(R.storage, "delete_file", _always_fail)

    p = pool(_DrainPool(3))
    out = await R.purge_punch_records()

    assert out["records_deleted"] == 0
    assert out["records_blocked"] == 3
    p.execute.assert_not_called()


# ── One pass failing must not skip the others ────────────────────────────────

@pytest.mark.asyncio
async def test_one_failing_pass_does_not_stop_the_rest(pool, monkeypatch):
    """
    A bucket outage must not also stop record expiry, which needs no object
    store at all.
    """
    async def _boom():
        raise RuntimeError("bucket unreachable")

    monkeypatch.setattr(R, "purge_punch_photos", _boom)

    async def _refs():
        return {"references_deleted": 2, "references_failed": 0, "references_drained": True}

    async def _recs():
        return {"records_deleted": 5, "records_blocked": 0, "records_drained": True}

    monkeypatch.setattr(R, "purge_reference_photos", _refs)
    monkeypatch.setattr(R, "purge_punch_records", _recs)

    out = await R.run_pahchan_retention()

    assert "punch_photos_error" in out
    assert out["references_deleted"] == 2
    assert out["records_deleted"] == 5
