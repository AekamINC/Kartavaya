"""The global write limiter: it bites, and it does not grow forever.

── THE LEAK, FOUND 2026-08-31 ─────────────────────────────────────────────────

`server.global_write_rate_limit` keeps its counters in a module-level dict keyed
by caller address. Entries were ADDED on every new key and REMOVED never — so
the dict's size was the number of distinct addresses that had ever issued a
write, for the life of the worker.

That is the quiet kind of defect: invisible for weeks, then a restart loop
nobody attributes to a rate limiter. Nothing raises, nothing logs, and the
symptom appears far from the cause.

Every value is `(minute, count)`, so an entry from a previous minute is already
dead — the code rewrites it on the next hit from that key and never reads the
old value. Sweeping them is free correctness.

── AND A SECOND FACT, RECORDED RATHER THAN FIXED ──────────────────────────────

This counter is PER WORKER. Production runs more than one, so the effective
ceiling is `_WRITE_LIMIT_PER_MIN x workers` and which counter a request lands on
is chance. `limiter.py` documents exactly this for slowapi and fixed it with a
shared Redis store; this middleware predates that and does not share it. It is a
coarse flood guard, not a quota, and the constant now says so. The auth-shaped
routes that DO need exactness carry their own slowapi limits.
"""
import asyncio

import pytest

import server


class FakeRequest:
    def __init__(self, ip, method="POST"):
        self.method = method
        self.headers = {"x-forwarded-for": ip}
        self.client = None


async def _passthrough(_request):
    return "OK"


@pytest.fixture(autouse=True)
def clean_buckets():
    server._write_rate_buckets.clear()
    server._write_rate_last_sweep = -1
    yield
    server._write_rate_buckets.clear()
    server._write_rate_last_sweep = -1


async def _call(ip, method="POST"):
    return await server.global_write_rate_limit(FakeRequest(ip, method), _passthrough)


# ── the limit still bites ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_limit_bites_at_the_configured_ceiling():
    limit = server._WRITE_LIMIT_PER_MIN
    for _ in range(limit):
        assert await _call("1.1.1.1") == "OK"
    blocked = await _call("1.1.1.1")
    assert getattr(blocked, "status_code", None) == 429, (
        "the global write limiter no longer refuses anything")


@pytest.mark.asyncio
async def test_one_callers_flood_does_not_block_another():
    """The key is per caller. This is what the Cloudflare key fix bought — with
    a proxy address as the key, one busy customer 429'd everybody."""
    for _ in range(server._WRITE_LIMIT_PER_MIN):
        await _call("1.1.1.1")
    assert await _call("2.2.2.2") == "OK"


@pytest.mark.asyncio
async def test_reads_are_never_limited():
    for _ in range(server._WRITE_LIMIT_PER_MIN * 2):
        assert await _call("1.1.1.1", method="GET") == "OK"
    assert not server._write_rate_buckets, "a GET created a counter"


# ── the leak ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stale_minutes_are_swept_so_the_dict_cannot_grow_forever():
    """1,000 addresses in one minute, then the clock moves on.

    Before the fix this dict held 1,001 entries and would hold them until the
    process died. After it, the previous minute's keys are gone.
    """
    server._write_rate_last_sweep = 12_345
    for i in range(1000):
        server._write_rate_buckets[f"global_write:10.0.{i // 256}.{i % 256}"] = (12_345, 1)
    assert len(server._write_rate_buckets) == 1000

    # A single request in a LATER minute must clear the previous minute's keys.
    server._write_rate_last_sweep = 12_345
    for k in list(server._write_rate_buckets):
        server._write_rate_buckets[k] = (12_345, 1)
    await _call("9.9.9.9")          # real clock, i.e. a minute far from 12_345

    assert len(server._write_rate_buckets) == 1, (
        f"stale counters survived the sweep: {len(server._write_rate_buckets)} "
        f"entries remain, so the dict grows without bound for the life of the "
        f"worker")


@pytest.mark.asyncio
async def test_the_sweep_does_not_drop_the_CURRENT_minute():
    """Anti-vacuity, and the way a leak fix breaks the feature it fixes: a sweep
    that cleared everything would reset every caller's count on the first
    request of each minute AND make the limit unenforceable."""
    for _ in range(5):
        await _call("1.1.1.1")
    await _call("2.2.2.2")
    assert len(server._write_rate_buckets) == 2
    assert server._write_rate_buckets["global_write:1.1.1.1"][1] == 5, (
        "the sweep discarded a live counter, so the limit can never be reached")


# ── TWO MUTATIONS THIS FILE DELIBERATELY DOES NOT CHASE ─────────────────────
#
# Mutation testing on 2026-08-31 left two survivors. Neither is a coverage gap,
# and writing a test that appeared to kill them would be worse than saying so:
#
# 1. REPLACING THE SELECTIVE DELETE WITH `_write_rate_buckets.clear()` is an
#    EQUIVALENT MUTANT. The sweep only runs when the minute has changed, and at
#    that instant every entry in the dict is from an earlier minute by
#    construction — an entry for the CURRENT minute could only have been written
#    by an earlier request in that same minute, which would already have moved
#    `_write_rate_last_sweep` forward and stopped the sweep from running. So the
#    two forms cannot differ in behaviour. The selective form is kept because it
#    stays correct if that guard is ever loosened, not because a test needs it.
#
# 2. SWEEPING ON EVERY REQUEST (`if True:` instead of the minute guard) changes
#    only COST, not behaviour: it walks the whole dict per write instead of once
#    a minute. There was a test here asserting `_write_rate_last_sweep` did not
#    move within a minute — it PASSED under the mutation, because the mutated
#    code assigns the same value it already held. It has been deleted rather
#    than left as a green check that proves nothing, which is precisely the
#    failure this suite exists to catch elsewhere.
