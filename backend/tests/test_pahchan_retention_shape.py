"""THE RETENTION PROMISE, AND THE JOIN NOBODY WAS TESTING.

`GET /v1/pahchan/me` answers `retention`, and the DPDP notice on both clients
prints a number out of it. Until 6 August 2026 that endpoint answered in TWO
INCOMPATIBLE SHAPES:

  · the employee branch built `{punch_photo_days, reference_photo_grace_days,
    record_retention_years}` — the names the clients read;
  · the no-employee branch returned `await _policy(...)` verbatim, whose column
    is `punch_photo_retention_days` — a name neither client reads.

Neither side errored. `pahchanNotice.js:132` and `noticeCopy.ts` both merge the
server dict OVER `RETENTION_FALLBACK` per key, so an absent key is a fallback
and not a failure: the notice printed the hardcoded 90 days. And the no-employee
branch is the one EVERY caller takes — `pahchan.py` says so twice, from a
measurement: 0 of 81 rows in `staging.manav_employees` carry a `user_id`, so
`_employee_for` returns None for everybody. `MyBiometrics.tsx:155` rendered
`undefined days, then deleted` on the same payload.

WHY IT SURVIVED A TEST SUITE. Both halves were tested and the join was not.
`frontend/src/__tests__/dpdpNotice.test.jsx:130` feeds `noticeLines` the CLIENT
shape and asserts the sentence; `tests/test_pahchan_notice.py` has no
`retention` assertion at all. Nothing anywhere fed the client function the dict
the server actually sends.

So this file does exactly that, three ways:

  1. drives BOTH branches of `my_punches` against a fake pool and insists the
     two `retention` dicts have the same keys AND the same values;
  2. proves the values come from the ORG POLICY rather than from a constant — an
     org on a 30-day window must be told 30;
  3. reads the two client copy modules as text and checks the three key names
     the server emits are the three key names they read. That is the join, and
     it is checked from this side because a rename on the server is what breaks
     it and the server is where a rename happens.
"""

import pathlib
import re

import pytest

from routers import pahchan
from routers.pahchan import DEFAULT_POLICY, _retention, my_punches

_REPO = pathlib.Path(__file__).resolve().parent.parent.parent
_WEB_COPY = _REPO / "frontend" / "src" / "lib" / "pahchanNotice.js"
_APP_COPY = _REPO / "mobile" / "src" / "screens" / "pahchan" / "noticeCopy.ts"

#: The three keys the clients read, written out by hand. Not derived from the
#: server and then compared to the server.
CLIENT_KEYS = {"punch_photo_days", "reference_photo_grace_days", "record_retention_years"}

#: The three POLICY columns they come from. Different name on the first one, and
#: that difference is the entire defect this file exists to keep fixed.
POLICY_COLUMNS = {
    "punch_photo_retention_days",
    "reference_photo_grace_days",
    "record_retention_years",
}

#: Deliberately not the defaults. If a branch ignored the policy and answered
#: from `DEFAULT_POLICY`, values equal to 90/45/3 would let it pass.
ORG_POLICY = dict(
    DEFAULT_POLICY,
    punch_photo_retention_days=30,
    reference_photo_grace_days=7,
    record_retention_years=8,
)


class _FakePool:
    """Enough of asyncpg for `my_punches`. `employee` decides which branch."""

    def __init__(self, employee=None, policy=None):
        self._employee = employee
        self._policy = policy if policy is not None else dict(ORG_POLICY)

    async def fetchrow(self, sql, *args):
        if "pahchan_policy" in sql:
            return dict(self._policy)
        if "manav_employees" in sql:
            return self._employee
        raise AssertionError(f"unexpected fetchrow: {sql[:60]}")

    async def fetch(self, sql, *args):
        return []

    async def fetchval(self, sql, *args):
        # The notice acknowledgement lookup. None = not acknowledged, which is
        # what a database with 113 unapplied answers too.
        return None


@pytest.fixture
def _pool(monkeypatch):
    holder = {}

    async def _get_pool():
        return holder["pool"]

    monkeypatch.setattr(pahchan, "get_pool", _get_pool)
    return holder


async def _me(holder, employee):
    holder["pool"] = _FakePool(employee=employee)
    return await my_punches(
        days=30,
        notice_version=pahchan.PAHCHAN_NOTICE_VERSION,
        user={"user_id": "user_probe"},
        org_id="00000000-0000-0000-0000-000000000001",
        _g=None,
    )


# ── 1. The two branches answer in one shape ──────────────────────────────────

async def test_both_branches_of_me_answer_the_same_retention_shape(_pool):
    """The regression, stated as the thing that was false.

    Keys AND values. Keys alone would pass a version that answered the right
    names with the wrong numbers, and the numbers are the promise.
    """
    without = await _me(_pool, employee=None)
    with_emp = await _me(
        _pool,
        employee={"id": "11111111-1111-1111-1111-111111111111", "name": "A Person"},
    )

    assert without["employee"] is None
    assert with_emp["employee"] is not None
    assert set(without["retention"]) == set(with_emp["retention"])
    assert without["retention"] == with_emp["retention"]


async def test_the_shape_is_the_one_the_clients_read_and_not_the_policy_row(_pool):
    """`punch_photo_retention_days` must not appear in either answer.

    It is the POLICY column name. Leaking it is not a cosmetic difference: the
    clients merge per key, so the wrong name is silently the fallback, and the
    fallback is a constant.
    """
    for employee in (None, {"id": "11111111-1111-1111-1111-111111111111", "name": "A"}):
        retention = (await _me(_pool, employee))["retention"]
        assert set(retention) == CLIENT_KEYS, retention
        assert "punch_photo_retention_days" not in retention


# ── 2. The number is the org's, not a constant ───────────────────────────────

async def test_an_org_on_a_thirty_day_window_is_told_thirty(_pool):
    """`pahchanNotice.js:22-26` is the requirement: an org that shortened its
    punch-photo window to 30 days must not have its notice say 90. Measured
    before the fix: it said 90, on every request, for every user."""
    for employee in (None, {"id": "11111111-1111-1111-1111-111111111111", "name": "A"}):
        retention = (await _me(_pool, employee))["retention"]
        assert retention["punch_photo_days"] == 30
        assert retention["reference_photo_grace_days"] == 7
        assert retention["record_retention_years"] == 8


async def test_an_org_with_no_policy_row_still_gets_the_client_shape(_pool):
    """`_policy` falls back to `DEFAULT_POLICY`, which is also keyed by the
    policy column names. The fallback path must be translated too — it is the
    one an org gets before anybody opens the policy screen, which is most of
    them."""
    _pool["pool"] = _FakePool(employee=None, policy=None)

    class _NoPolicy(_FakePool):
        async def fetchrow(self, sql, *args):
            if "pahchan_policy" in sql:
                return None
            return await super().fetchrow(sql, *args)

    _pool["pool"] = _NoPolicy(employee=None)
    out = await my_punches(
        days=30,
        notice_version=pahchan.PAHCHAN_NOTICE_VERSION,
        user={"user_id": "user_probe"},
        org_id="00000000-0000-0000-0000-000000000001",
        _g=None,
    )
    assert set(out["retention"]) == CLIENT_KEYS
    assert out["retention"]["punch_photo_days"] == DEFAULT_POLICY["punch_photo_retention_days"]


# ── 3. The helper, and the columns it depends on ─────────────────────────────

def test_the_helper_reads_columns_that_exist():
    """Every source column `_retention` names is a key of `DEFAULT_POLICY`, and
    `DEFAULT_POLICY` mirrors `staging.pahchan_policy`. A rename on either side
    becomes a KeyError here rather than a fallback on a legal notice."""
    assert POLICY_COLUMNS <= set(DEFAULT_POLICY)
    assert set(_retention(DEFAULT_POLICY)) == CLIENT_KEYS


def test_the_helper_is_the_only_place_the_translation_is_written():
    """Two dict literals is how the two branches came to disagree. If a third
    caller builds the mapping by hand, this fails and the fix is to call the
    helper."""
    src = (pathlib.Path(pahchan.__file__)).read_text(encoding="utf-8")
    body = src[src.index("def _retention("):]
    body = body[: body.index("\n\n\nasync def")]
    assert body.count('"punch_photo_days"') == 1
    assert src.count('"punch_photo_days"') == 1, (
        "the policy-to-client translation is written more than once in "
        "routers/pahchan.py. Call _retention()."
    )
    assert src.count("_retention(") >= 3  # the def plus both branches


# ── 4. THE JOIN. The clients read exactly these three names ──────────────────

def _js_fallback_keys(path: pathlib.Path) -> set[str]:
    """The keys of `RETENTION_FALLBACK` in a client copy module.

    Cut to the object literal rather than grepped over the file: both modules
    argue about these names at length in prose, and a grep would find the
    argument. A missing file FAILS rather than skips — a guard that silently
    stops guarding is worse than no guard.
    """
    assert path.exists(), f"{path} is missing; this guard cannot silently pass"
    text = path.read_text(encoding="utf-8")
    m = re.search(r"RETENTION_FALLBACK[^{]*\{(.*?)\}", text, re.S)
    assert m, f"{path.name} has no RETENTION_FALLBACK literal"
    return set(re.findall(r"([a-z_]+)\s*:", m.group(1)))


@pytest.mark.parametrize("path", [_WEB_COPY, _APP_COPY], ids=["web", "mobile"])
def test_the_client_reads_the_keys_the_server_sends(path):
    """The assertion that was missing on 6 August 2026.

    `frontend/src/__tests__/dpdpNotice.test.jsx` feeds `noticeLines` a
    hand-written client-shaped dict and never the server's; this file feeds the
    server's real answer. Between them the join is covered from both ends.
    """
    assert _js_fallback_keys(path) == CLIENT_KEYS


@pytest.mark.parametrize("path", [_WEB_COPY, _APP_COPY], ids=["web", "mobile"])
def test_no_client_interpolates_a_policy_column_name(path):
    """If a client ever "fixed" this by reading `punch_photo_retention_days`
    instead, the two would agree again — on the WRONG name, and the employee
    branch would then be the one silently falling back."""
    text = path.read_text(encoding="utf-8")
    body = text[text.index("Punch photos are deleted after"):]
    assert "punch_photo_retention_days" not in body


def test_the_two_clients_have_not_drifted_from_each_other():
    assert _js_fallback_keys(_WEB_COPY) == _js_fallback_keys(_APP_COPY)


def test_the_fallback_is_the_servers_default_policy():
    """`pahchanNotice.js:63-67` claims these are `DEFAULT_POLICY`'s figures. A
    fallback that drifted from the server default would show one number before
    the request lands and a different one after, on a legal notice."""
    text = _WEB_COPY.read_text(encoding="utf-8")
    m = re.search(r"RETENTION_FALLBACK[^{]*\{(.*?)\}", text, re.S)
    pairs = dict(re.findall(r"([a-z_]+)\s*:\s*(\d+)", m.group(1)))
    server = _retention(DEFAULT_POLICY)
    assert {k: int(v) for k, v in pairs.items()} == server


async def test_the_notice_gate_is_untouched_by_this(_pool):
    """The notice block still answers beside `retention` on BOTH branches.

    The fix moved one key inside the no-employee return, and that return is also
    where the gate above the camera comes from. A regression that dropped
    `notice` there would show every person the DPDP notice again on every
    launch, forever.
    """
    for employee in (None, {"id": "11111111-1111-1111-1111-111111111111", "name": "A"}):
        out = await _me(_pool, employee)
        assert out["notice"]["version"] == pahchan.PAHCHAN_NOTICE_VERSION
        assert out["notice"]["acknowledged_at"] is None
