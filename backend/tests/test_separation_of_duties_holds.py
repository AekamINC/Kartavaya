"""
test_separation_of_duties_holds.py — the approver gate, in BOTH of its states.

WHAT IS BEING GUARDED
────────────────────────────────────────────────────────────────────────────────
`middleware/module_levels.py::require_level(module, "approver")` is the only
consumer of the rule that, in Vetana (payroll) and Ganit (invoicing), ADMIN DOES
NOT SATISFY APPROVER. Its own docstring states the stronger half:

    "Refusing platform staff is deliberate and is the stronger half of the
     rule: Aekam support must never be able to release a customer's money."

Whether that rule is enforced at all is decided by a table-existence probe:

    SELECT to_regclass('org_module_approvers') IS NOT NULL

MEASURED, 2026-08-29: that probe returns NULL. `org_module_approvers` exists in
NEITHER product schema, so the fallback below is the LIVE behaviour of the
product today — not a hypothetical. That is a deliberate choice pending
PROPOSED_074 (enforcing an approver grant against a table with nowhere to write
one would lock every org out of its own books, including one-person firms with
no second person to grant to).

So this file does not assert a stricter rule that is fiction. It asserts:

  · the rule as it will be once PROPOSED_074 lands — table PRESENT;
  · the fallback EXACTLY as it behaves today — table ABSENT — including its
    blast radius, written down as executable assertions rather than as a comment
    nobody reads;
  · that the probe result LATCHES for the life of the process, so applying
    PROPOSED_074 under a running service does NOT turn the gate on.

WHY THE GUARD IS CALLED DIRECTLY AND NOT THROUGH HTTP
────────────────────────────────────────────────────────────────────────────────
`require_level()` returns a plain async function whose two parameters carry
`Depends(...)` DEFAULTS. Calling it with explicit arguments exercises the real
guard with nothing else in the frame — no route, no module gate, no
subscription check — so a failure here can only be the guard.

WHY THE QUERY ROUTING NEVER MATCHES A SCHEMA NAME
────────────────────────────────────────────────────────────────────────────────
MEASURED ON THIS BRANCH, 2026-08-29, mid-consolidation:
`tests/test_ganit_separated_duty.py` routed its stub answers on
`"staging.user_roles" in query` while `middleware/module_levels.py` had already
moved to `public.user_roles`. Those branches stopped matching, the stub fell
through to `return 0` for every role probe, and the run was:

    FAILED test_before_migration_org_owner_may_still_cancel   (expected 200, got 403)

— while `test_platform_admin_cannot_approve_without_an_explicit_grant` stayed
GREEN for a reason that was no longer the reason it stated: the platform probe
was answering 0 for everybody, so that 403 proved nothing about platform staff.
A security test that keeps passing after its stub goes blind is the worse half
of that pair.

Those stubs have since been repaired — by re-pinning them to `public.`, which
re-arms the identical trap for the next move.

A harness pinned to the identifier a migration moves goes quiet exactly when it
is needed. Every predicate below keys on something no schema change touches —
`to_regclass`, `org_module_approvers`, `org_id IS NULL`, `org_owner` — and
`RecordingPool` RAISES on an unmatched query, so going blind fails here instead
of silently answering 0.

NO DATABASE. Nothing here opens a socket, and there is no module- or
fixture-scope `except Exception: pytest.skip(...)` for this file to hide behind.
"""

import pytest

from middleware.role_tiers import can_reach_module

from middleware import module_levels
from middleware.module_levels import require_level, reset_approver_table_cache
from middleware.role_tiers import (
    ADMIN,
    APPROVER,
    EDITOR,
    PLATFORM_ROLE_PRECEDENCE,
    SEPARATED_DUTY_MODULES,
    VIEWER,
    can_reach_module,
)

ORG_ID = "00000000-0000-0000-0000-0000000000f4"
CALLER = "user_finance_lead_001"

#: Both separated-duty modules, so neither can be fixed while the other rots.
SEPARATED = sorted(SEPARATED_DUTY_MODULES)          # ["ganit", "vetana"]


class UnmodelledQuery(AssertionError):
    """The guard asked something this test did not describe.

    conftest's shared pool is a MagicMock that answers 0 to anything, so a test
    built on it passes over code paths nobody has considered. This raises
    instead.
    """


class RecordingPool:
    """Answers the guard's probes per query, and remembers every one."""

    def __init__(
        self,
        *,
        approver_table: bool,
        org_role: str | None = None,
        platform_role: str | None = None,
        approver_row=None,
        module_grant: str | None = None,
    ):
        #: Does `org_module_approvers` resolve? False is today's live answer.
        self.approver_table = approver_table
        #: 'org_owner' / 'org_admin' / None — what `_org_role` finds.
        self.org_role = org_role
        #: The caller's strongest platform role, or None.
        self.platform_role = platform_role
        #: 1 when an explicit, unrevoked approver row exists.
        self.approver_row = approver_row
        #: `org_member_modules.role` for the caller, if any.
        self.module_grant = module_grant
        self.seen: list[str] = []

    def asked(self, fragment: str) -> int:
        return sum(1 for q in self.seen if fragment in q)

    async def fetchval(self, query, *args):
        q = " ".join(str(query).split())
        self.seen.append(q)
        if "to_regclass" in q and "org_module_approvers" in q:
            return self.approver_table
        if "org_module_approvers" in q:
            return self.approver_row
        if "user_roles" in q and "org_id IS NULL" in q:
            return self.platform_role
        if "user_roles" in q and "org_owner" in q:
            return self.org_role
        if "org_member_modules" in q:
            return self.module_grant
        raise UnmodelledQuery(
            f"require_level() issued a query this test does not model: {q!r}"
        )


@pytest.fixture(autouse=True)
def _clean_probe_cache():
    """`_approver_table_exists` is a module global that outlives any one test.

    Without this, the FIRST test in the process to touch the guard decides the
    answer for every later one — and the symptom lands in an unrelated file.
    """
    reset_approver_table_cache()
    yield
    reset_approver_table_cache()


@pytest.fixture
def guard(monkeypatch):
    """Run the real dependency against a pool this test describes.

    `module_levels.get_pool` is a module global looked up at call time, so
    replacing the attribute is enough; `db._pool` is untouched.
    """
    def _bind(pool):
        async def _get_pool():
            return pool

        monkeypatch.setattr(module_levels, "get_pool", _get_pool)

        async def _run(module_code: str, required: str, user_id: str = CALLER):
            check = require_level(module_code, required)
            return await check(user={"user_id": user_id}, org_id=ORG_ID)

        return _run

    return _bind


def _refusal(excinfo) -> str:
    return str(excinfo.value.detail)


# ══════════════════════════════════════════════════════════════════════════════
# PART 1 — the approver table PRESENT: the rule as PROPOSED_074 will enforce it
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("module", SEPARATED)
async def test_present_an_explicit_approver_grant_passes(guard, module):
    """The one thing that approves: a row that says so, and can be revoked."""
    pool = RecordingPool(approver_table=True, approver_row=1)
    await guard(pool)(module, APPROVER)          # no raise == admitted
    assert pool.asked("org_module_approvers") >= 2, (
        "The guard admitted the caller without ever reading the approver "
        f"table. Statements: {pool.seen!r}"
    )


@pytest.mark.parametrize("module", SEPARATED)
@pytest.mark.parametrize("org_role", ["org_owner", "org_admin"])
async def test_present_org_management_without_a_grant_is_refused(guard, module, org_role):
    """Breadth is not depth. Owning the org does not release its money."""
    pool = RecordingPool(approver_table=True, org_role=org_role, approver_row=None)
    with pytest.raises(Exception) as exc:
        await guard(pool)(module, APPROVER)
    assert exc.value.status_code == 403, (
        f"{org_role} approved in {module} with no approver grant."
    )
    assert "explicit approver grant" in _refusal(exc), (
        "The refusal must say WHY, so the reader knows to ask for a second "
        f"grant rather than assume a bug. detail={_refusal(exc)!r}"
    )


@pytest.mark.parametrize("module", SEPARATED)
@pytest.mark.parametrize("platform_role", list(PLATFORM_ROLE_PRECEDENCE))
async def test_present_platform_staff_is_refused_including_god_mode(
    guard, module, platform_role,
):
    """The stronger half of the rule, asserted for EVERY platform code.

    Parametrised over `PLATFORM_ROLE_PRECEDENCE` rather than over one hand-picked
    role, so a code added to that tuple is covered the day it is added.
    """
    pool = RecordingPool(
        approver_table=True, platform_role=platform_role, approver_row=None,
    )
    with pytest.raises(Exception) as exc:
        await guard(pool)(module, APPROVER)
    assert exc.value.status_code == 403, (
        f"Aekam's {platform_role} could approve in a customer's {module}. "
        "module_levels.require_level's docstring: 'Aekam support must never be "
        "able to release a customer's money.'"
    )


@pytest.mark.parametrize("module", SEPARATED)
async def test_present_separation_does_not_creep_into_the_lower_rungs(guard, module):
    """org_admin still administers. A control that swallows ordinary work is a
    control that gets switched off wholesale."""
    for rung in (VIEWER, EDITOR, ADMIN):
        pool = RecordingPool(approver_table=True, org_role="org_admin")
        await guard(pool)(module, rung)          # no raise


async def test_present_a_hierarchical_module_is_untouched(guard):
    """Outside Vetana and Ganit, admin still satisfies approver — otherwise this
    change would have silently locked approvals across the whole product."""
    pool = RecordingPool(approver_table=True, org_role="org_admin")
    await guard(pool)("vikray", APPROVER)        # no raise
    assert pool.asked("org_module_approvers") == 0, (
        "A hierarchical module consulted the approver table; the separated-duty "
        "branch is leaking into modules it does not govern."
    )


# ══════════════════════════════════════════════════════════════════════════════
# PART 2 — the approver table ABSENT: TODAY'S LIVE BEHAVIOUR, blast radius and all
#
#   ⚠ This part documents the product as it is. `to_regclass('org_module_approvers')`
#     returns NULL on the live database (measured 2026-08-29), so every assertion
#     below describes what happens on a real request right now.
#
#     It is a deliberate choice, not an accident: until PROPOSED_074 creates the
#     table there is nowhere to record an approver, and failing closed would lock
#     every org out of cancelling an invoice or paying a vendor bill.
#
#     The cost of that choice is what the tests below make executable. When
#     PROPOSED_074 lands, these do not become wrong — they become unreachable,
#     because the probe stops returning NULL. Part 1 is what will then run.
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("module", SEPARATED)
@pytest.mark.parametrize("org_role", ["org_owner", "org_admin"])
async def test_absent_org_management_keeps_the_access_it_has_today(
    guard, module, org_role,
):
    """The documented fallback: unchanged behaviour on an unmigrated database."""
    pool = RecordingPool(approver_table=False, org_role=org_role)
    await guard(pool)(module, APPROVER)          # no raise


@pytest.mark.parametrize("module", SEPARATED)
async def test_absent_a_plain_member_is_still_refused(guard, module):
    """The fallback is a fallback, not an open door. If this ever passes, the
    absent-table branch has stopped checking anything at all."""
    pool = RecordingPool(approver_table=False, org_role=None, platform_role=None)
    with pytest.raises(Exception) as exc:
        await guard(pool)(module, APPROVER)
    assert exc.value.status_code == 403
    assert "approver rights" in _refusal(exc)


@pytest.mark.parametrize("module", SEPARATED)
@pytest.mark.parametrize("platform_role", list(PLATFORM_ROLE_PRECEDENCE))
async def test_absent_platform_staff_are_admitted_only_within_module_reach(
    guard, module, platform_role,
):
    """The fallback is now exactly as wide as the ladder it stands in for.

    ⚠ IT WAS NOT, UNTIL 2026-08-29. This test previously asserted the opposite
    and was named THE_BLAST_RADIUS: the fallback tested `_platform_role(...)`
    for truthiness alone, so ANY platform role could approve a payroll run or
    void a tax invoice — including `sahayak_admin`, which role_tiers says has
    "no business in a customer's CRM", and `platform_support`, which "currently
    gets nothing". `held_level()` had always gated on `can_reach_module()`; the
    fallback simply omitted the clause.

    Kept parametrised over every code in PLATFORM_ROLE_PRECEDENCE, so a role
    added later is covered on the day it is added rather than the day someone
    remembers. `vetana` admits platform_owner and platform_admin; `ganit` also
    admits platform_manager; every other code is refused by both.

    This still does NOT assert the full separation rule — that needs
    PROPOSED_074 and an explicit approver grant. It asserts the narrower thing
    that is true today: the fallback is not a hole that is wider than the door.
    """
    pool = RecordingPool(approver_table=False, org_role=None, platform_role=platform_role)
    reachable = can_reach_module(platform_role, module)

    if reachable:
        await guard(pool)(module, APPROVER)      # admitted, same as the ladder
    else:
        with pytest.raises(Exception) as exc:
            await guard(pool)(module, APPROVER)
        assert exc.value.status_code == 403, (
            f"{platform_role!r} cannot reach {module!r} per role_tiers, so the "
            "fallback must refuse it exactly as held_level() would. It did not."
        )

    assert pool.asked("org_id IS NULL") == 1, (
        "The decision must have come from the platform-role probe; if it did "
        f"not, this test is asserting the wrong thing. Statements: {pool.seen!r}"
    )


@pytest.mark.parametrize("module", SEPARATED)
async def test_absent_the_fallback_is_no_wider_than_module_reach(guard, module):
    """The regression test for the hole this file was written to expose.

    ⚠ UNTIL 2026-08-29 THIS ASSERTED THE OPPOSITE, and was named
    `..._is_wider_than_module_reach_itself`. The fallback tested
    `_platform_role(...)` for TRUTHINESS ONLY and never asked
    `can_reach_module()`, so a role role_tiers says may not enter the module AT
    ALL was admitted to approve inside it:

      · `sahayak_admin` — role_tiers: "Authors Sahayak skills, and nothing else…
        they have no business in a customer's CRM, sales pipeline or analytics."
      · `platform_support` — role_tiers: "NOT yet implemented … a holder of this
        role currently gets nothing."

    Both are in `PLATFORM_ROLE_PRECEDENCE`, the list `_platform_role`'s
    `role_code = ANY($2)` matches, so both came back truthy and both were let
    through. `held_level()` on the non-separated path had always consulted
    `can_reach_module`; the fallback simply omitted the clause.

    The clause is now there, and this test is what stops it being dropped again.
    """
    for role in ("sahayak_admin", "platform_support"):
        assert not can_reach_module(role, module), (
            f"Premise changed: role_tiers now lets {role} reach {module}. This "
            "test no longer guards what it claims to — re-point it at a role "
            "that still cannot reach the module, rather than deleting it."
        )
        pool = RecordingPool(approver_table=False, platform_role=role)
        with pytest.raises(Exception) as exc:
            await guard(pool)(module, APPROVER)
        assert exc.value.status_code == 403, (
            f"{role!r} cannot reach {module!r}, so the approver fallback must "
            "refuse it exactly as the ordinary ladder would. This is the "
            "regression that let Aekam support release a customer's money."
        )


# ══════════════════════════════════════════════════════════════════════════════
# PART 3 — the probe LATCHES, which is why the state above is sticky
# ══════════════════════════════════════════════════════════════════════════════

async def test_the_absent_answer_is_cached_for_the_life_of_the_process(guard):
    """`if _approver_table_exists is None:` caches False as firmly as True.

    Consequence: applying PROPOSED_074 does NOT arm the gate. Every worker that
    was already running keeps admitting platform staff until it is redeployed —
    so the migration's cutover is a deploy, not a transaction, and seeding
    approver rows inside the migration does not close the window.
    """
    # `platform_admin`, not `platform_staff`: since 2026-08-29 the fallback also
    # gates on can_reach_module, and `platform_staff` cannot reach vetana — it
    # would be refused before ever reaching the caching behaviour under test.
    # This test is about the LATCH, so it needs a role the reach gate admits.
    absent = RecordingPool(approver_table=False, platform_role="platform_admin")
    await guard(absent)("vetana", APPROVER)      # admitted via the fallback
    assert absent.asked("to_regclass") == 1

    # PROPOSED_074 is applied. Same process, same worker, table now present and
    # this caller holds no approver row.
    present = RecordingPool(approver_table=True, platform_role="platform_admin",
                            approver_row=None)
    try:
        await guard(present)("vetana", APPROVER)     # STILL ADMITTED
    except Exception as exc:
        pytest.fail(
            "The probe no longer latches: applying PROPOSED_074 armed the gate "
            "inside an already-running process. That is a better product, but "
            "it means module_levels.py's 'cached after first hit' note and this "
            f"test are now both stale. Guard raised: {exc!r}"
        )
    assert present.asked("to_regclass") == 0, (
        "The guard re-probed. If the cache no longer latches, this test's whole "
        "premise is gone — and the redeploy note in module_levels.py is stale."
    )

    # A redeploy is what actually arms it. `reset_approver_table_cache()` is the
    # test seam that stands in for a fresh process.
    reset_approver_table_cache()
    after = RecordingPool(approver_table=True, platform_role="platform_staff",
                          approver_row=None)
    with pytest.raises(Exception) as exc:
        await guard(after)("vetana", APPROVER)
    assert exc.value.status_code == 403, (
        "After a restart the gate must be live: the only difference between "
        "this call and the one above is that the cached probe was cleared."
    )


async def test_a_failing_probe_fails_open_but_does_not_latch(guard):
    """`approver_table_available` swallows a probe error and returns False —
    WITHOUT caching it, because the assignment never happens.

    That distinction matters: a single connection blip must not disarm the gate
    until the next deploy. This asserts the module global is still unset, which
    is the only observable difference between the two failure modes.
    """
    class ExplodingPool(RecordingPool):
        async def fetchval(self, query, *args):
            q = " ".join(str(query).split())
            self.seen.append(q)
            if "to_regclass" in q:
                raise RuntimeError("connection reset by peer")
            return await super().fetchval(query, *args)

    pool = ExplodingPool(approver_table=True, org_role="org_owner")
    await guard(pool)("ganit", APPROVER)         # fell back, admitted org_owner
    assert module_levels._approver_table_exists is None, (
        "A failed probe latched. One connection blip would then disarm the "
        "approver gate for the whole life of the process."
    )
    assert pool.asked("org_module_approvers") == 1, (
        "Only the probe should have run; the grant lookup is behind it."
    )


# ══════════════════════════════════════════════════════════════════════════════
# PART 4 — the two states are the same guard, and only the probe separates them
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("module", SEPARATED)
@pytest.mark.parametrize(
    "table_present, platform_staff_admitted",
    [(False, True), (True, False)],
    ids=["table-absent-today", "table-present-after-074"],
)
async def test_one_probe_decides_whether_aekam_can_release_a_customers_money(
    guard, module, table_present, platform_staff_admitted,
):
    """Identical caller, identical request; only `to_regclass` differs.

    Nothing else about the caller changes across the two parameters, so the
    outcome cannot be attributed to anything but the table-existence probe.
    """
    pool = RecordingPool(
        approver_table=table_present, platform_role="platform_owner",
        approver_row=None,
    )
    if platform_staff_admitted:
        await guard(pool)(module, APPROVER)
    else:
        with pytest.raises(Exception) as exc:
            await guard(pool)(module, APPROVER)
        assert exc.value.status_code == 403
