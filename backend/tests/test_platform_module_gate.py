"""The platform branch of `require_module`: what it refuses, and what it records.

THE DEFECT THIS FILE EXISTS FOR
-------------------------------
`require_module` ended its platform branch in a bare `return` for every
non-sensitive module. That statement left the function before the write-level
check and before anything that could write an audit row, so the measured chain

    POST /api/v1/vikray/orders   as platform_staff   (`vikray` ∈ STAFF_MODULES)

reached the handler, INSERTed a row, and left NO TRACE ANYWHERE. The cross-org
half is closed in `org_resolver.py` (c7494db6). The half that lived in this
gate is the silence, and a privileged path that leaves no trace is the actual
defect — everything else is consequence.

WHY THE MODULE LISTS BELOW ARE WRITTEN OUT BY HAND
--------------------------------------------------
Every expectation here is a LITERAL. None of it is derived from
`STAFF_MODULES`, `MANAGER_MODULES` or `ALL_MODULES`.

That is deliberate and it is the whole value of the file. A test that asks
"is every module outside the allowed set refused" is computed as
ALL-minus-ALLOWED, and it CANNOT FAIL when someone widens the allowed set —
the forbidden set shrinks to match and the assertion still passes. Writing the
reach table out by hand means widening `STAFF_MODULES` breaks a test that names
the module it just admitted.

The same applies to the audit table: it names the twelve module codes rather
than iterating `ALL_MODULES`, so adding a thirteenth module without deciding
whether it is sensitive fails here instead of defaulting to silence.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from middleware.subscription import (
    PLATFORM_MODULE_LEVEL,
    PLATFORM_WRITE_ACTION,
    SENSITIVE_ACCESS_ACTION,
    SENSITIVE_MODULES,
    platform_audit_needed,
    platform_audit_row,
    platform_refusal,
)

pytestmark = pytest.mark.asyncio

ORG = "00000000-0000-0000-0000-000000000001"

#: The twelve module codes, written out. Not imported from `ALL_MODULES`.
EVERY_MODULE = (
    "graha", "vikray", "prachar", "sahayak", "dristi", "sanvaad",
    "ganit", "esign", "varta", "pahchan", "manav", "vetana",
    #: `kray` — procurement, its own module since `7770045b` (23 Aug). The
    #: assertion that caught its absence says exactly what to do about it:
    #: "add the module to EVERY_MODULE and decide whether it is sensitive — do
    #: not let it default into silence." It is sensitive; see below.
    "kray",
)

#: The five that hold payroll, the books, procurement, HR files or biometric
#: attendance.
#: Written out so that quietly dropping one from `SENSITIVE_MODULES` fails here.
#: `kray` added 2026-08-27, four days after `7770045b` put it in
#: `SENSITIVE_MODULES`. Procurement holds vendor bills, payments and
#: supplier bank details; the reason lives beside the set in
#: `middleware/subscription.py`. A module that is sensitive in the product
#: and absent here is a module whose gate nothing exercises.
EVERY_SENSITIVE_MODULE = ("vetana", "ganit", "manav", "pahchan", "kray")

#: What each platform role may reach, BY HAND. See the module docstring for why
#: this is not `modules_for(role)`.
REACH = {
    # God mode, under both spellings. Everything.
    "platform_owner": set(EVERY_MODULE),
    "platform_admin": set(EVERY_MODULE),
    # Everything except HR and Payroll. Note that this STILL CONTAINS `ganit`,
    # `pahchan` and now `kray`, all sensitive — so reach is not the last word and
    # the sensitive rule refuses it there. That interaction is why the earlier
    # claim that platform_manager could silently write everywhere was overstated:
    # its real silent-write set was eight modules, not ten.
    #
    # `kray` follows the rule this line states rather than being an exception to
    # it: procurement is not HR and not payroll, so platform_manager reaches it —
    # and is then refused by sensitivity, exactly as it is for the other two. The
    # code already said so; this table had not caught up since `7770045b`, and
    # the assertion's own words are the standard here: "the table in this file is
    # the decision that was made; update it deliberately or fix the code."
    "platform_manager": {
        "graha", "vikray", "prachar", "sahayak", "dristi", "sanvaad",
        "ganit", "esign", "varta", "pahchan", "kray",
    },
    # The operating set: CRM, sales, marketing, Sahayak, analytics, messaging.
    "platform_staff": {
        "graha", "vikray", "prachar", "sahayak", "dristi", "sanvaad",
    },
    # Authors Sahayak skills and nothing else.
    "sahayak_admin": {"sahayak"},
    # Commercial and support roles reach no operational module at all.
    "account_manager": set(),
    "account_finance": set(),
    "platform_support": set(),
}


# ══════════════════════════════════════════════════════════════════════════════
# 1. The refusal policy, as a pure function
# ══════════════════════════════════════════════════════════════════════════════

class TestWhatIsRefused:

    @pytest.mark.parametrize("role", sorted(REACH))
    @pytest.mark.parametrize("module", EVERY_MODULE)
    async def test_reach_matches_the_table_written_by_hand(self, role, module):
        """Reach, for every role × every module, against literals.

        Asserted against `can_reach_module` and NOT against the combined
        refusal, because the two are genuinely different questions and merging
        them is how the earlier reading of this gate went wrong. `ganit` and
        `pahchan` are IN platform_manager's reach and it is still refused them —
        by the sensitive rule, one line later. Testing only the combined answer
        would let someone delete either rule and stay green as long as the other
        still said no. The next test pins which rule is doing the work.
        """
        from middleware.role_tiers import can_reach_module

        assert can_reach_module(role, module) is (module in REACH[role]), (
            f"{role}'s reach into {module} changed. The table in this file is "
            "the decision that was made; update it deliberately or fix the code."
        )

    @pytest.mark.parametrize("module", ["ganit", "pahchan"])
    async def test_platform_manager_is_stopped_by_sensitivity_not_by_reach(
        self, module,
    ):
        """The correction that matters, pinned so it cannot be re-lost.

        `MANAGER_MODULES` is `ALL_MODULES - HR_MODULES`, which still contains
        `ganit` and `pahchan`. So platform_manager DOES reach them and is
        refused anyway. Its real silent-write set was the staff six plus `esign`
        and `varta` — eight modules — not everything.

        Deleting the sensitive rule would therefore ADMIT platform_manager to
        the books and to biometric attendance while every reach test stayed
        green. This is the assertion that would fail.
        """
        from middleware.role_tiers import can_reach_module

        assert can_reach_module("platform_manager", module) is True
        msg = platform_refusal("platform_manager", module, is_write=False)
        assert msg is not None and "payroll" in msg, (
            f"platform_manager reaches {module} and nothing stopped it"
        )

    @pytest.mark.parametrize("module", EVERY_SENSITIVE_MODULE)
    async def test_only_god_mode_crosses_into_payroll_and_the_books(self, module):
        """The part that was already RIGHT, pinned so a rewrite cannot lose it.

        `platform_manager` is the one this actually bites at runtime: its reach
        table above includes `ganit` and `pahchan`, and the sensitive rule is
        what stops it there. For `vetana` and `manav` reach already said no, so
        both rules agree and the refusal is over-determined — which is fine, and
        is why both are asserted.
        """
        for role in ("platform_manager", "platform_staff", "account_manager",
                     "sahayak_admin", "platform_support", "account_finance"):
            assert platform_refusal(role, module, is_write=False) is not None, (
                f"{role} reached the {module} module, which holds payroll, "
                "financial, HR or biometric data"
            )
        for role in ("platform_owner", "platform_admin"):
            assert platform_refusal(role, module, is_write=False) is None

    async def test_the_payroll_refusal_says_why(self):
        """The message is the only thing the refused person sees."""
        msg = platform_refusal("platform_manager", "ganit", is_write=False)
        assert "ganit" in msg
        assert "payroll" in msg

    async def test_an_unknown_role_reaches_nothing(self):
        """`modules_for` fails closed. Asserted from this side too: a role code
        added to the database enum but never to `role_tiers` must be refused,
        not silently handed god mode."""
        for module in EVERY_MODULE:
            assert platform_refusal("wizard", module, is_write=False) is not None
            assert platform_refusal(None, module, is_write=False) is not None

    async def test_the_write_rung_is_consulted_and_todays_answer_is_yes(self):
        """HONEST TRIPWIRE. This does not refuse anything today and says so.

        `PLATFORM_MODULE_LEVEL` is ADMIN and `level_satisfies(ADMIN, EDITOR, m)`
        is True for all twelve, so a platform write is admitted. The value is
        that the branch now goes THROUGH the rung rather than around it: raise
        the bar for writes anywhere and the ten platform accounts move with
        everyone else instead of silently not moving.

        If a future change makes this refuse, that is not a bug in this test —
        change the assertion deliberately and say which rung moved.
        """
        for module in REACH["platform_owner"]:
            assert platform_refusal(
                "platform_owner", module, is_write=True
            ) is None, f"platform_owner was refused a write on {module}"

    async def test_the_rung_is_a_real_ladder_not_a_constant(self):
        """The rung would bite on the separated-duty modules if anything asked
        for APPROVER, because admin does not climb into approver in Vetana or
        Ganit — whoever defines what people are paid must not release the money.

        Asserted against `level_satisfies` directly so the claim in the source
        comment is checked rather than merely written down.
        """
        from middleware.role_tiers import APPROVER, EDITOR, level_satisfies
        assert level_satisfies(PLATFORM_MODULE_LEVEL, EDITOR, "vetana") is True
        assert level_satisfies(PLATFORM_MODULE_LEVEL, APPROVER, "vetana") is False
        assert level_satisfies(PLATFORM_MODULE_LEVEL, APPROVER, "ganit") is False


# ══════════════════════════════════════════════════════════════════════════════
# 2. Which crossings leave a row
# ══════════════════════════════════════════════════════════════════════════════

class TestWhatIsRecorded:

    @pytest.mark.parametrize("module", EVERY_MODULE)
    async def test_every_write_leaves_a_row(self, module):
        """THE FIX, stated over the whole module list.

        Not `for m in ALL_MODULES` — a thirteenth module added to that set
        would be covered automatically and nobody would have decided anything.
        Here it fails until somebody writes it down.
        """
        assert platform_audit_needed(module, is_write=True) is True, (
            f"a platform write to {module} would leave no trace"
        )

    @pytest.mark.parametrize("module", EVERY_SENSITIVE_MODULE)
    async def test_every_sensitive_read_leaves_a_row(self, module):
        assert platform_audit_needed(module, is_write=False) is True

    @pytest.mark.parametrize("module", [
        m for m in EVERY_MODULE if m not in EVERY_SENSITIVE_MODULE
    ])
    async def test_a_non_sensitive_read_stays_silent(self, module):
        """The standing volume decision, unchanged and asserted so that
        reversing it is a choice rather than an accident. ~400 endpoints hang
        off this dependency and list traffic dominates them; a row per read
        buries the warn-severity rows that carry the signal."""
        assert platform_audit_needed(module, is_write=False) is False

    async def test_the_sensitive_action_name_never_moves(self):
        """312 rows already carry it (measured 2026-08-05), and every one means
        "a god-mode account was GRANTED a sensitive module". Renaming it or
        reusing it for something else rewrites what those rows say."""
        assert SENSITIVE_ACCESS_ACTION == "platform.sensitive_module_access"
        assert PLATFORM_WRITE_ACTION != SENSITIVE_ACCESS_ACTION

    @pytest.mark.parametrize("module", EVERY_SENSITIVE_MODULE)
    async def test_a_sensitive_crossing_is_warn_whether_or_not_a_member(self, module):
        """Reading a salary register is not made routine by belonging to the
        org, and the action name must stay the one the existing rows use."""
        for member in (True, False):
            action, severity = platform_audit_row(
                module, is_write=False, is_member=member
            )
            assert action == SENSITIVE_ACCESS_ACTION
            assert severity == "warn"

    async def test_a_write_inside_your_own_org_is_info(self):
        """Nine of the ten live platform accounts belong to Aekam Inc and to
        nothing else. If every one of their writes were `warn`, the warns that
        matter would be invisible inside them."""
        action, severity = platform_audit_row(
            "vikray", is_write=True, is_member=True
        )
        assert action == PLATFORM_WRITE_ACTION
        assert severity == "info"

    async def test_a_write_into_an_org_you_do_not_belong_to_is_warn(self):
        """The spec's actual line: "no one should be able to see any other org
        data even god mode users". An Aekam account operating inside a customer
        org is the event somebody must be able to find in one query."""
        action, severity = platform_audit_row(
            "vikray", is_write=True, is_member=False
        )
        assert action == PLATFORM_WRITE_ACTION
        assert severity == "warn"

    @pytest.mark.parametrize("module", [
        m for m in EVERY_MODULE if m not in EVERY_SENSITIVE_MODULE
    ])
    async def test_no_row_is_planned_for_a_silent_read(self, module):
        assert platform_audit_row(
            module, is_write=False, is_member=True
        ) is None
        assert platform_audit_row(
            module, is_write=False, is_member=False
        ) is None

    async def test_the_two_sets_this_file_pins_still_match_the_code(self):
        """The literals above are the point of this file, but a literal that has
        drifted from the code tests nothing. This is the one place they are
        compared, so a deliberate change breaks exactly one assertion with a
        name that says what to do."""
        assert set(EVERY_SENSITIVE_MODULE) == set(SENSITIVE_MODULES), (
            "SENSITIVE_MODULES changed. Update EVERY_SENSITIVE_MODULE here and "
            "confirm the new membership is what the owner decided."
        )
        from middleware.role_tiers import ALL_MODULES
        assert set(EVERY_MODULE) == set(ALL_MODULES), (
            "ALL_MODULES changed. Add the module to EVERY_MODULE and decide "
            "whether it is sensitive — do not let it default into silence."
        )


# ══════════════════════════════════════════════════════════════════════════════
# 3. End to end through the dependency
#
# The pure functions above are the policy; this is the proof that the branch
# actually asks them. A gate that computes the right answer and then returns
# before using it is exactly the bug being fixed.
# ══════════════════════════════════════════════════════════════════════════════

def _request(method: str, path: str, user_id: str = "u_platform"):
    req = MagicMock()
    req.method = method
    req.url = MagicMock()
    req.url.path = path
    req.headers = {}
    req.client = None
    req.state = MagicMock()
    req.state._auth_user = {"user_id": user_id}
    return req


def _pool(platform_role: str | None, *, is_member: bool):
    """A pool that answers the two probes the platform branch makes.

    The platform probe is the one with `org_id IS NULL`; the membership probe is
    the one with `org_id=$2::uuid`. Anything else answers None, so a third query
    appearing in this branch shows up as a failure rather than as a mock quietly
    inventing a row.
    """
    pool = MagicMock()

    async def _fetchval(sql, *args):
        s = " ".join(sql.split())
        if "org_id IS NULL" in s:
            return platform_role
        if "org_id=$2::uuid" in s and "role_code = ANY" in s:
            return 1 if is_member else None
        return None

    pool.fetchval = AsyncMock(side_effect=_fetchval)
    pool.fetch = AsyncMock(return_value=[])
    pool.fetchrow = AsyncMock(return_value=None)
    pool.execute = AsyncMock()
    return pool


async def _run(monkeypatch, role, module, method, path, *, is_member=False):
    """Drive `require_module(module)`'s inner dependency. Returns (result, rows)
    where result is None on a pass or the HTTPException on a refusal."""
    from fastapi import HTTPException
    import middleware.subscription as sub

    rows = []
    monkeypatch.setattr(
        sub, "audit",
        lambda action, request=None, **kw: rows.append((action, kw)),
    )
    pool = _pool(role, is_member=is_member)

    async def _get_pool():
        return pool

    monkeypatch.setattr(sub, "get_pool", _get_pool)

    dep = sub.require_module(module)
    inner = dep.dependency if hasattr(dep, "dependency") else dep
    try:
        return await inner(_request(method, path), org_id=ORG), rows
    except HTTPException as exc:
        return exc, rows


class TestTheBranchAsksThePolicy:

    async def test_the_measured_chain_now_leaves_a_row(self, monkeypatch):
        """POST /api/v1/vikray/orders as platform_staff.

        This is the exact request that INSERTed a row into another org and left
        nothing behind. It is still ADMITTED — `vikray` is in the operating set
        and Aekam runs an agency service — but it is no longer invisible.
        """
        out, rows = await _run(
            monkeypatch, "platform_staff", "vikray",
            "POST", "/api/v1/vikray/orders",
        )
        assert out is None, "platform_staff lost a module it is meant to have"
        assert len(rows) == 1, "the measured chain still leaves no audit row"

        action, kw = rows[0]
        assert action == PLATFORM_WRITE_ACTION
        assert kw["severity"] == "warn", "a write into a non-member org is warn"
        assert kw["org_id"] == ORG, "the row must name the org that was written to"
        assert kw["user_id"] == "u_platform"
        assert kw["resource_id"] == "vikray"
        assert kw["detail"]["role"] == "platform_staff"
        assert kw["detail"]["method"] == "POST"
        assert kw["detail"]["path"] == "/api/v1/vikray/orders"
        assert kw["detail"]["write"] is True
        assert kw["detail"]["member"] is False

    async def test_the_same_write_by_a_member_is_recorded_as_ordinary(
        self, monkeypatch,
    ):
        out, rows = await _run(
            monkeypatch, "platform_staff", "vikray",
            "POST", "/api/v1/vikray/orders", is_member=True,
        )
        assert out is None
        assert len(rows) == 1
        assert rows[0][1]["severity"] == "info"
        assert rows[0][1]["detail"]["member"] is True

    async def test_a_non_sensitive_read_is_still_silent(self, monkeypatch):
        """The standing volume decision, held end to end. `test_rbac_isolation`
        asserts the same thing; both are here on purpose, because this is the
        assertion most likely to be broken by accident while adding rows."""
        out, rows = await _run(
            monkeypatch, "platform_staff", "graha",
            "GET", "/api/v1/graha/contacts",
        )
        assert out is None
        assert rows == []

    async def test_a_silent_read_by_a_member_costs_two_probes_and_no_more(
        self, monkeypatch,
    ):
        """The branch runs on every request the ten platform accounts make, so
        what it spends is worth pinning.

        THIS USED TO ASSERT ONE PROBE, on the reasoning that membership was "a
        value that is never read". It is read now, and by the thing that makes
        this gate correct: a support session may only cap an Aekam account acting
        inside an org it does NOT belong to, so membership is what decides whether
        the session is consulted at all. The optimisation the old assertion
        protected was buying a round trip at the price of never applying the
        customer's access_level — measured, a platform_staff holding a
        `graha / viewer` session was admitted to POST across STAFF_MODULES.

        Nine of the ten live platform accounts are members of Aekam Inc and of
        nothing else, so THIS is the common path, and it must still make no
        session lookup at all."""
        import middleware.subscription as sub

        pool = _pool("platform_staff", is_member=True)
        monkeypatch.setattr(sub, "audit", lambda *a, **k: None)

        async def _get_pool():
            return pool

        monkeypatch.setattr(sub, "get_pool", _get_pool)
        dep = sub.require_module("graha")
        inner = dep.dependency if hasattr(dep, "dependency") else dep
        await inner(_request("GET", "/api/v1/graha/contacts"), org_id=ORG)

        assert pool.fetchval.await_count == 2, (
            "a silent read made more than the platform-role and membership probes"
        )
        assert pool.fetchrow.await_count == 0, (
            "a member's request paid for a support-session lookup it can never "
            "be subject to"
        )

    async def test_a_non_member_pays_one_session_lookup_and_exactly_one(
        self, monkeypatch,
    ):
        """The price of the cap, bounded and stated. `active_support_session`
        caches on `request.state`, so `get_org_id` and this gate asking the same
        question about the same request is one query, not two."""
        import middleware.subscription as sub

        pool = _pool("platform_staff", is_member=False)
        monkeypatch.setattr(sub, "audit", lambda *a, **k: None)

        async def _get_pool():
            return pool

        monkeypatch.setattr(sub, "get_pool", _get_pool)
        dep = sub.require_module("graha")
        inner = dep.dependency if hasattr(dep, "dependency") else dep
        request = _request("GET", "/api/v1/graha/contacts")
        await inner(request, org_id=ORG)
        await inner(request, org_id=ORG)

        assert pool.fetchrow.await_count == 1, (
            "the session lookup is not cached per request"
        )

    async def test_a_sensitive_read_keeps_the_row_it_already_wrote(
        self, monkeypatch,
    ):
        """312 existing rows depend on this shape. `via` in particular is read
        by whatever built them."""
        out, rows = await _run(
            monkeypatch, "platform_admin", "vetana",
            "GET", "/api/v1/vetana/payruns",
        )
        assert out is None
        assert len(rows) == 1
        action, kw = rows[0]
        assert action == SENSITIVE_ACCESS_ACTION
        assert kw["severity"] == "warn"
        assert kw["resource_type"] == "module"
        assert kw["resource_id"] == "vetana"
        assert kw["detail"]["via"] == "platform_bypass"
        assert kw["detail"]["role"] == "platform_admin"

    async def test_a_refused_role_never_reaches_the_handler(self, monkeypatch):
        out, rows = await _run(
            monkeypatch, "platform_staff", "vetana",
            "GET", "/api/v1/vetana/payruns",
        )
        assert getattr(out, "status_code", None) == 403
        assert "vetana" in out.detail

    async def test_platform_manager_is_refused_on_ganit_not_admitted(
        self, monkeypatch,
    ):
        """Reach says yes (MANAGER_MODULES contains ganit), sensitivity says no.
        End to end, because the two rules disagreeing is the interesting case
        and only the combined answer matters."""
        out, rows = await _run(
            monkeypatch, "platform_manager", "ganit",
            "POST", "/api/v1/ganit/invoices",
        )
        assert getattr(out, "status_code", None) == 403
        assert "payroll" in out.detail
        assert rows == [], "a refusal must not be filed as an access"

    async def test_an_ordinary_member_never_enters_this_branch(self, monkeypatch):
        """The gate's other half is untouched. With no platform row the caller
        falls through to the grant check, which refuses for want of a grant —
        and writes nothing to the audit either way."""
        out, rows = await _run(
            monkeypatch, None, "graha", "GET", "/api/v1/graha/contacts",
        )
        assert getattr(out, "status_code", None) == 403
        assert "don't have access" in out.detail
        assert rows == []

    @pytest.mark.parametrize("path", [
        "/api/v1/documents/gst/gstr3b/2026-07/pdf",
        "/api/v1/dristi/query",
    ])
    async def test_a_read_shaped_post_is_not_treated_as_a_write(
        self, monkeypatch, path,
    ):
        """`_is_write` is now resolved once and shared by both branches. If the
        platform branch ever computed it separately the two could disagree, and
        a generated GSTR-3B would be filed as a change to the books."""
        out, rows = await _run(
            monkeypatch, "platform_staff", "dristi", "POST", path,
        )
        assert out is None
        assert rows == [], "a document generation was recorded as a write"
