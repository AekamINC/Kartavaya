"""Who may write a row into `staging.org_member_modules`, and at what level.

── WHAT WAS OPEN ─────────────────────────────────────────────────────────────

`role_tiers.SEPARATED_DUTY_MODULES` says admin does not imply approver on Vetana
and Ganit: whoever defines what people are paid must not be the one who releases
the money. `org_invites._validate_grants` enforced that with an owner-only rule.
It was the ONLY writer of four that did.

The two endpoints that actually write grant rows — `POST /api/v1/org/members`
and `PUT /api/v1/org/members/{id}/modules` — checked the module code and the
level and stopped. Neither had a self-target check either (`update_member_role`,
directly above one of them, blocks self). So:

    PUT /api/v1/org/members/{the caller's own user_id}/modules
    {"modules": [{"code": "vetana", "role": "approver"}]}

from an org_admin was a 200, `held_module_levels` then returned
{admin (by org role), approver (by the new row)}, and `vetana._RELEASE_LEVEL`
was satisfied by the same person who configures salary structures. No audit row
was written on any path in that file.

A guard on one writer of four is not a guard. It is worse than none, because the
file that carries it documents the rule at length and the three that do not
carry it read as inheriting it.

── HOW THIS FILE IS BUILT ────────────────────────────────────────────────────

Three layers, and the middle one is the point:

  1. The policy as a PURE function — no database, no FastAPI, so the rule can be
     held directly rather than inferred from a 403. Same reason
     `_assert_invite_is_only_an_org_admin` was written pure.
  2. A WALK of the router package that finds every statement touching the grant
     table and asserts its module reaches the validator. A writer added next
     month fails this test rather than slipping past it — which is exactly what
     the seventh writer did last time.
  3. The regressions themselves, at the level of the endpoint.
"""

import ast
import pathlib

import pytest

from middleware.role_tiers import (
    ADMIN,
    ALL_MODULES,
    APPROVER,
    EDITOR,
    HIERARCHICAL_MODULES,
    LADDER_MODULES,
    NO_APPROVER_MODULES,
    NO_VIEWER_MODULES,
    SEPARATED_DUTY_MODULES,
    VIEWER,
    grant_audit_severity,
    refuse_grant,
    refuse_grant_shape,
    valid_levels_for,
)

BACKEND = pathlib.Path(__file__).resolve().parent.parent

#: The table a grant row lives in. Named once — the walk below greps for it.
GRANT_TABLE = "org_member_modules"


# ══════════════════════════════════════════════════════════════════════════════
# 1 · The policy, as a pure function
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_an_org_admin_cannot_grant_approver_on_a_separated_duty_module(module):
    """THE hole. An org_admin already holds ADMIN on every active module by role
    alone, so this one grant row is the whole of the separation."""
    refusal = refuse_grant(module, APPROVER, caller_org_role="org_admin")
    assert refusal is not None
    assert refusal.status == 403
    assert module in refusal.detail


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_an_org_owner_still_can(module):
    """The five live `vetana: approver` rows must stay creatable. Refusing
    sensitive grant rows outright — which is what RBAC-SPEC.md:65-71 literally
    asks for — deletes the ability to appoint a payroll approver, and Vetana has
    no other representation of it, so payroll fails closed with a 403."""
    assert refuse_grant(module, APPROVER, caller_org_role="org_owner") is None


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
@pytest.mark.parametrize("level", [VIEWER, EDITOR, ADMIN])
def test_the_rule_bites_only_the_approver_rung(module, level):
    """Non-admin HR and books access is the ordinary case for anyone in an HR
    team who is not the owner — `test_module_grant_enforcement.py` says so in as
    many words. This must not become a refusal of sensitive modules."""
    assert refuse_grant(module, level, caller_org_role="org_admin") is None


@pytest.mark.parametrize("module", sorted(ALL_MODULES - SEPARATED_DUTY_MODULES))
def test_approver_elsewhere_is_untouched(module):
    """Only vetana and ganit separate the duties. Anywhere else an org_admin
    grants approver freely — where the level exists at all."""
    if APPROVER not in valid_levels_for(module):
        pytest.skip(f"{module} has no approver rung")
    assert refuse_grant(module, APPROVER, caller_org_role="org_admin") is None


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_a_caller_with_no_org_row_is_not_refused(module):
    """None means god mode / platform, whom `require_org_role` already vouched
    for. `org_invites._assert_may_grant_role` has always behaved this way and
    moving the rule must not change a single verdict."""
    assert refuse_grant(module, APPROVER, caller_org_role=None) is None


def test_the_shape_check_refuses_an_unknown_module():
    refusal = refuse_grant_shape("payroll", VIEWER)
    assert refusal is not None and refusal.status == 400


@pytest.mark.parametrize("module", sorted(NO_APPROVER_MODULES & ALL_MODULES))
def test_the_shape_check_refuses_a_level_the_module_has_no_use_for(module):
    """A grant that silently does nothing is the failure `valid_levels_for`
    exists to prevent, and `accept-invite` applied no level check at all."""
    refusal = refuse_grant_shape(module, APPROVER)
    assert refusal is not None and refusal.status == 400


def test_authority_is_only_ever_checked_after_shape():
    """A malformed grant must answer 400, not 403 — otherwise an org_admin
    typo'ing a module name is told they lack authority they would not have
    needed."""
    refusal = refuse_grant("nonesuch", APPROVER, caller_org_role="org_admin")
    assert refusal is not None and refusal.status == 400


# ══════════════════════════════════════════════════════════════════════════════
# 2 · The walk — every writer of the grant table reaches the validator
#
# This is the test that had to exist. The previous refusal was correct and
# present on one writer of four; nothing anywhere asserted that the OTHER
# writers had it, so the hole was invisible to the suite. Enumerating the
# writers from the source means a fifth one fails here instead of shipping.
# ══════════════════════════════════════════════════════════════════════════════


def _sources() -> list[pathlib.Path]:
    out = []
    for path in BACKEND.rglob("*.py"):
        parts = path.parts
        if "tests" in parts or "__pycache__" in parts or "migrations" in parts:
            continue
        out.append(path)
    return out


def _sql_blob(text: str) -> str:
    """The file's SQL as one flat lowercase string.

    Every one of these statements is written as adjacent Python string literals
    split across lines, so a naive substring search for
    `insert into staging.org_member_modules` finds nothing and a loose search
    for the table name alone finds `org_modules.py` and `vetana.py`, which only
    ever COUNT rows in it. Closing the literal boundaries first is what makes
    "writes" distinguishable from "mentions".
    """
    import re

    joined = re.sub(r"""["']\s*\+?\s*["']""", "", text)
    return re.sub(r"\s+", " ", joined).lower()


def _writes_grant_rows(text: str) -> bool:
    """Does this module INSERT a row into the grant table?

    INSERT only. A DELETE is revocation — it removes authority rather than
    handing it out — so `org_members.remove_member` is not dragged into a rule
    about granting.
    """
    return f"insert into staging.{GRANT_TABLE}" in _sql_blob(text)


#: The writer that puts the grant in an INVITE rather than in the grant table.
#:
#: `org_invites` never touches `org_member_modules` — it writes
#: `invites.module_grants`, which `accept-invite` later copies across. It is
#: nonetheless the writer of RECORD for those grants and is where the granting
#: authority is checked, so it is held to the full rule. Named separately
#: because the table walk cannot find it, and a walk that silently missed a
#: writer is the failure this file exists to prevent.
INDIRECT_WRITERS = {"routers/org_invites.py"}


def test_the_writers_are_the_ones_this_file_knows_about():
    """Pin the enumeration itself.

    If this fails with a NEW name, a further endpoint can now write grant rows
    and the test below must be taught whether it is allowed to. Do not simply
    add the name — decide first whether that writer applies the policy.
    """
    writers = {
        path.relative_to(BACKEND).as_posix()
        for path in _sources()
        if _writes_grant_rows(path.read_text(encoding="utf-8-sig", errors="ignore"))
    }
    assert writers == {
        "auth_router.py",
        "routers/admin_orgs.py",
        "routers/org_members.py",
    }, writers


def test_every_direct_writer_is_covered_by_a_rule_in_this_file():
    """The join between the walk and the policy table below.

    Without this, adding a fifth writer would fail only the enumeration test,
    and the obvious way to 'fix' that failure is to paste the new name into the
    expected set — which is precisely how a writer ships unguarded.
    """
    writers = {
        path.relative_to(BACKEND).as_posix()
        for path in _sources()
        if _writes_grant_rows(path.read_text(encoding="utf-8-sig", errors="ignore"))
    } | INDIRECT_WRITERS
    covered = set(_REQUIRED_VALIDATOR) | {"routers/admin_orgs.py"}
    assert writers <= covered, (
        f"these write module grants and no rule in this file covers them: "
        f"{sorted(writers - covered)}"
    )


#: Which validator each writer must reach, and why that one.
#:
#: `org_invites` writes the invite ROW rather than the grant row, but it is the
#: writer of record for that grant and carries the authority check, so it is
#: held to the full rule.
_REQUIRED_VALIDATOR = {
    "routers/org_members.py": "refuse_grant",
    "routers/org_invites.py": "refuse_grant",
    # The invitee is not the granter — authority was checked at creation. Shape
    # only. See `role_tiers.refuse_grant`.
    "auth_router.py": "refuse_grant_shape",
}


def _calls(text: str) -> set[str]:
    """Every function name this module actually CALLS.

    An AST walk and not a substring search, and the difference is not academic:
    the first version of this test searched the file text, and unwiring
    `org_members` completely still passed — because the word `refuse_grant`
    survived in a docstring explaining the rule. A check that a comment can
    satisfy is a guard with a hole, which is the thing this whole file is about.
    """
    found: set[str] = set()
    for node in ast.walk(ast.parse(text)):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name):
            found.add(func.id)
        elif isinstance(func, ast.Attribute):
            found.add(func.attr)
    return found


@pytest.mark.parametrize("module_path,validator", sorted(_REQUIRED_VALIDATOR.items()))
def test_every_grant_writer_calls_the_one_validator(module_path, validator):
    """Source-level, deliberately — the same shape as
    `test_level_satisfies_now_has_production_callers`. A guard that is quietly
    unwired reverts the product to the state this file documents, and a
    behavioural test on one endpoint would not notice another losing it."""
    text = (BACKEND / module_path).read_text(encoding="utf-8-sig")
    assert validator in _calls(text), (
        f"{module_path} writes module grants without CALLING "
        f"role_tiers.{validator} — the separated-duty rule is not applied there"
    )


def _names_used(text: str) -> set[str]:
    """Identifiers that appear as real code, not in a comment or docstring."""
    return {
        node.id for node in ast.walk(ast.parse(text)) if isinstance(node, ast.Name)
    }


def test_the_console_writer_refuses_sensitive_modules_instead():
    """`admin_orgs` is the seventh writer and takes a different remedy, because
    its caller set is Aekam's console rather than the customer's own owner: it
    refuses the sensitive codes outright, which is what its own sibling
    `_assert_invite_is_only_an_org_admin` already does 270 lines above it.

    That endpoint reaches ANY org — `require_platform_role` is not org-scoped —
    so the four `platform_staff` holders whom `subscription.platform_refusal`
    forbids from touching payroll could otherwise grant it to somebody else.
    """
    text = (BACKEND / "routers/admin_orgs.py").read_text(encoding="utf-8-sig")
    assert "SENSITIVE_MODULES" in _names_used(text)


#: Files allowed to reason about the separated-duty rule for themselves.
#:
#: `middleware/module_levels.py` is the READ side — it decides whether a level
#: already held satisfies a route's requirement, which is a different question
#: from who may hand that level out, and it has its own PROPOSED_074 fallback
#: that `refuse_grant` must not inherit. `role_tiers.py` is the definition.
_MAY_RESTATE_THE_RULE = {"role_tiers.py", "module_levels.py"}


def test_no_grant_writer_carries_its_own_copy_of_the_separated_duty_rule():
    """The rule moved to one place. A writer that re-implements it locally is
    how the four drifted apart the first time — `org_invites` had it, three did
    not, and nothing said so.

    Scoped to WRITERS. The read-side gate is excluded by name rather than by
    accident, so removing it from that set is a deliberate act.
    """
    offenders = []
    for path in _sources():
        if path.name in _MAY_RESTATE_THE_RULE:
            continue
        text = path.read_text(encoding="utf-8-sig", errors="ignore")
        if "SEPARATED_DUTY_MODULES" not in text:
            continue
        for node in ast.walk(ast.parse(text)):
            # `x in SEPARATED_DUTY_MODULES` combined with an APPROVER comparison
            # in the same boolean expression is the rule being retyped.
            if not isinstance(node, ast.BoolOp):
                continue
            src = ast.unparse(node)
            if "SEPARATED_DUTY_MODULES" in src and "APPROVER" in src:
                offenders.append(f"{path.relative_to(BACKEND).as_posix()}:{node.lineno}")
    assert not offenders, (
        "the separated-duty rule is restated outside role_tiers.refuse_grant: "
        + ", ".join(offenders)
    )


def test_the_org_endpoints_write_an_audit_row():
    """They wrote nothing, on any path. The owner's decision allows one person to
    hold admin and approver — "one user can have both FYI but auditable" — and
    the word doing the work in that sentence had no implementation."""
    text = (BACKEND / "routers/org_members.py").read_text(encoding="utf-8-sig")
    assert "org.module_grant_changed" in text
    assert "grant_audit_severity" in _calls(text)
    assert "audit" in _calls(text)


def test_the_new_audit_action_is_not_the_platform_crossing_action():
    """312 rows in `staging.audit_log` already carry
    `platform.sensitive_module_access`, and every one means "a god-mode account
    was granted a sensitive module". Reusing it for an org admin editing
    checkboxes would retroactively change what those rows say."""
    from middleware.subscription import SENSITIVE_ACCESS_ACTION

    text = (BACKEND / "routers/org_members.py").read_text(encoding="utf-8-sig")
    assert SENSITIVE_ACCESS_ACTION not in text


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_a_sensitive_grant_is_audited_at_warn(module):
    assert grant_audit_severity(module, APPROVER) == "warn"
    assert grant_audit_severity(module, VIEWER) == "warn"


def test_pahchan_is_audited_at_warn_even_though_it_is_not_in_the_narrow_set():
    """The two SENSITIVE_MODULES sets differ on `pahchan` — three codes in
    `role_tiers`, four in `subscription`. Both are right for their own job. The
    severity helper names which one it means so a future rule cannot inherit the
    ambiguity."""
    assert grant_audit_severity("pahchan", VIEWER) == "warn"


def test_an_ordinary_grant_is_not_noise():
    assert grant_audit_severity("graha", VIEWER) == "info"
    assert grant_audit_severity("graha", EDITOR) == "info"


# ══════════════════════════════════════════════════════════════════════════════
# 3 · The ladder sets agree
#
# `kartavya` was in HIERARCHICAL_MODULES, NO_APPROVER_MODULES and
# NO_VIEWER_MODULES and in no set that said what the ladder's DOMAIN was, while
# `manav`, `pahchan` and `varta` were in neither half of the hierarchy split.
# Neither was a live defect — nothing gates on HIERARCHICAL_MODULES, and
# `level_satisfies` already treats anything outside SEPARATED_DUTY_MODULES
# hierarchically — but sets that are silent about a module cannot be checked.
# ══════════════════════════════════════════════════════════════════════════════


def test_the_ladder_domain_is_all_modules_plus_kartavya():
    """One code, and it is deliberate: core PM is levelled but not grantable —
    reached by org membership, not by a grant row."""
    assert LADDER_MODULES - ALL_MODULES == {"kartavya"}
    assert ALL_MODULES < LADDER_MODULES


@pytest.mark.parametrize(
    "name,members",
    sorted({
        "HIERARCHICAL_MODULES": HIERARCHICAL_MODULES,
        "SEPARATED_DUTY_MODULES": SEPARATED_DUTY_MODULES,
        "NO_APPROVER_MODULES": NO_APPROVER_MODULES,
        "NO_VIEWER_MODULES": NO_VIEWER_MODULES,
    }.items()),
)
def test_no_ladder_set_names_a_module_the_ladder_does_not_know(name, members):
    assert members <= LADDER_MODULES, f"{name} names {sorted(members - LADDER_MODULES)}"


def test_the_hierarchy_split_partitions_the_ladder():
    """The check that keeps them from drifting again. A module added to
    `ALL_MODULES` and to neither half inherits "admin approves" without anybody
    stating it — which is the wrong default for anything that moves money."""
    assert HIERARCHICAL_MODULES | SEPARATED_DUTY_MODULES == LADDER_MODULES
    assert not (HIERARCHICAL_MODULES & SEPARATED_DUTY_MODULES)


def test_kartavya_is_still_not_grantable():
    """Naming the domain must not have made core PM a grant code. Four files
    state that it is reached by membership; `_validate_grant` must still 400."""
    assert "kartavya" not in ALL_MODULES
    refusal = refuse_grant_shape("kartavya", EDITOR)
    assert refusal is not None and refusal.status == 400


# ══════════════════════════════════════════════════════════════════════════════
# 4 · The console writer, end to end
#
# `PUT /api/v1/admin/orgs/{org_id}/members/{target}/modules` had no test of any
# kind. It validated the module code and nothing else, its guard
# (`require_platform_role(*CONSOLE_ROLES)`) is NOT org-scoped so it reached any
# organisation, and its sibling 270 lines above in the same file refuses exactly
# this. A mocked pool cannot prove a row was written — it CAN prove the handler
# refuses before it tries, which is the thing that was missing.
# ══════════════════════════════════════════════════════════════════════════════

CONSOLE_ORG = "00000000-0000-0000-0000-0000000000c0"
CONSOLE_TARGET = "u_target"
CONSOLE_URL = f"/api/v1/admin/orgs/{CONSOLE_ORG}/members/{CONSOLE_TARGET}/modules"


@pytest.fixture
def as_console(app, member_user):
    """`require_platform_role` reads the pool, which conftest mocks; overriding
    `require_user` is what the console suite already does."""
    from auth_router import require_user

    app.dependency_overrides[require_user] = lambda: member_user
    yield member_user
    app.dependency_overrides.pop(require_user, None)


@pytest.mark.parametrize("module", ["vetana", "ganit", "manav", "pahchan"])
async def test_the_console_refuses_a_sensitive_grant(
    api_client, as_console, mock_pool, module,
):
    """All FOUR of `subscription.SENSITIVE_MODULES`, `pahchan` included.

    The narrow three-code set in `role_tiers` is the wrong one here: this is
    "may a platform role hand this out", and biometric attendance is in scope
    for that question even though it is handed out by default to org members.
    """
    mock_pool.fetchval.return_value = "platform_admin"
    mock_pool.fetch.return_value = []

    r = await api_client.put(CONSOLE_URL, json={
        "user_id": CONSOLE_TARGET, "modules": ["graha", module],
    })

    assert r.status_code == 400, r.text
    assert module in r.text


async def test_the_console_still_grants_ordinary_modules(
    api_client, as_console, mock_pool,
):
    """The refusal must not become a refusal of the endpoint. Aekam still
    administers the operating set for a customer it is running an agency service
    for."""
    mock_pool.fetchval.return_value = "platform_admin"
    mock_pool.fetch.return_value = []

    r = await api_client.put(CONSOLE_URL, json={
        "user_id": CONSOLE_TARGET, "modules": ["graha", "vikray"],
    })

    assert r.status_code == 200, r.text


def test_the_console_delete_cannot_reach_a_sensitive_grant():
    """The other half, and the one a status-code test cannot see.

    Refusing sensitive codes in the REQUEST BODY is not enough: the handler
    replaces the member's whole grant set, so a console save listing nothing but
    `graha` would still have dropped their `vetana: approver` row on the way
    past — five such rows exist across three orgs and are the only record of who
    may release payroll. The DELETE must be scoped to what this console may
    write.
    """
    import inspect

    from routers.admin_orgs import set_member_modules

    src = inspect.getsource(set_member_modules)
    delete = src[src.index("DELETE FROM staging.org_member_modules"):]
    delete = delete[:delete.index(")")]
    assert "SENSITIVE_MODULES" in src
    assert "NOT (module_code = ANY" in delete, (
        "the console DELETE is unscoped — it can revoke a payroll approver it "
        "is not allowed to grant"
    )


def test_the_console_insert_names_the_level_column():
    """It never named `role`, so every grant landed on `DEFAULT 'viewer'` — the
    exact demotion `org_members.py` documents as fixed on its own endpoint."""
    import inspect

    from routers.admin_orgs import set_member_modules

    src = inspect.getsource(set_member_modules)
    insert = src[src.index("INSERT INTO staging.org_member_modules"):]
    assert "role" in insert[:insert.index("VALUES")]


# ══════════════════════════════════════════════════════════════════════════════
# 5 · The org's OWN editor, end to end
#
# Everything above section 4 tests the policy as a pure function, and the pure
# function was right. What it could not see is that
# `PUT /api/v1/org/members/{id}/modules` is REPLACE-semantics and
# `TabMembers.jsx:371` posts `editing.draft` — the member's WHOLE current grant
# list — on every save. Running the authority half over every entry therefore
# ran it over entries the request did not touch:
#
#   member already holds vetana:approver; admin edits their Graha level
#   PUT {"modules":[{"code":"vetana","role":"approver"},
#                   {"code":"graha","role":"admin"}]}    -> 403
#
# Nothing about vetana changed in that request. Five members across three live
# orgs hold a separated-duty approver grant, and every one of them became
# un-editable by an org_admin; the only way through the form was to uncheck
# Vetana, which DELETES the org's payroll approver.
#
# These are endpoint tests deliberately. The pure-function tests cannot see a
# no-op re-save, because from the function's side a re-save and a fresh grant
# are the same two arguments.
# ══════════════════════════════════════════════════════════════════════════════

ORG = "fae87907-0000-0000-0000-0000000000fa"
CALLER = "user_mem001"          # matches the `member_user` fixture
TARGET = "u_target"
MODULES_URL = f"/api/v1/org/members/{TARGET}/modules"


@pytest.fixture
def org_editor(app, member_user):
    """The org's own admin/owner, with `get_org_id` pinned.

    `require_org_role` is a factory — a fresh `_check` per route — so it cannot
    be overridden by key. It is satisfied through the pool instead, which is
    also what makes the caller's org role settable per test.
    """
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: member_user
    app.dependency_overrides[get_org_id] = lambda: ORG
    yield member_user
    app.dependency_overrides.pop(require_user, None)
    app.dependency_overrides.pop(get_org_id, None)


def _route_pool(mock_pool, *, caller_role: str, held: dict, has_owner: bool):
    """Answer each of this endpoint's four reads by SQL TEXT.

    The same technique `tests/test_roles_org_scope.py` uses, and for the same
    reason: `require_org_role`, `_caller_org_role` and `_org_has_owner` all
    `fetchval` against `staging.user_roles`, and a single return value cannot
    tell them apart.
    """
    async def fetchval(sql, *args):
        if "org_id IS NULL" in sql:
            return None                       # not a platform account
        if "role_code='org_owner'" in sql:
            return 1 if has_owner else None
        if "staging.user_roles" in sql:
            return caller_role                # the gate, and _caller_org_role
        return None

    async def fetch(sql, *args):
        if "org_member_modules" in sql:
            return [{"module_code": c, "role": r} for c, r in held.items()]
        return []

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetch.side_effect = fetch
    return mock_pool


@pytest.fixture
def captured_audit(monkeypatch):
    """`services.audit.emit` is fire-and-forget, so the row is asserted where
    the router hands it over."""
    import routers.org_members as om

    rows = []
    monkeypatch.setattr(om, "audit", lambda action, request, **kw: rows.append(kw))
    return rows


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
async def test_an_admin_can_still_edit_a_member_who_already_holds_approver(
    api_client, org_editor, mock_pool, module,
):
    """THE REGRESSION. The re-save carries the approver grant UNCHANGED and
    changes something else; nothing here hands out authority."""
    _route_pool(mock_pool, caller_role="org_admin",
                held={module: APPROVER, "graha": EDITOR}, has_owner=True)

    r = await api_client.put(MODULES_URL, json={"modules": [
        {"code": module, "role": APPROVER},
        {"code": "graha", "role": ADMIN},
    ]})

    assert r.status_code == 200, r.text


async def test_the_unchanged_grant_is_still_shape_checked(
    api_client, org_editor, mock_pool,
):
    """Exempting unchanged grants from the AUTHORITY half must not exempt them
    from the shape half — otherwise a stored junk level round-trips forever."""
    _route_pool(mock_pool, caller_role="org_admin",
                held={"vetana": "god"}, has_owner=True)

    r = await api_client.put(MODULES_URL, json={
        "modules": [{"code": "vetana", "role": "god"}],
    })

    assert r.status_code == 400, r.text


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
async def test_an_admin_still_cannot_mint_a_new_approver(
    api_client, org_editor, mock_pool, module,
):
    """The hole, at the endpoint. `held` has no approver row, so this request
    CREATES the authority."""
    _route_pool(mock_pool, caller_role="org_admin",
                held={"graha": EDITOR}, has_owner=True)

    r = await api_client.put(MODULES_URL, json={"modules": [
        {"code": module, "role": APPROVER},
    ]})

    assert r.status_code == 403, r.text
    assert module in r.text


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
async def test_an_admin_still_cannot_raise_an_existing_grant_to_approver(
    api_client, org_editor, mock_pool, module,
):
    """The case the no-op exemption is most likely to swallow: the module IS in
    `before`, at a different level. `before.get(code) != level`, so the whole
    rule applies."""
    _route_pool(mock_pool, caller_role="org_admin",
                held={module: EDITOR}, has_owner=True)

    r = await api_client.put(MODULES_URL, json={"modules": [
        {"code": module, "role": APPROVER},
    ]})

    assert r.status_code == 403, r.text


async def test_an_admin_still_cannot_grant_it_to_themselves(
    api_client, org_editor, mock_pool,
):
    """The original privilege escalation, spelled out: the caller IS the target
    and holds nothing on vetana yet."""
    _route_pool(mock_pool, caller_role="org_admin", held={}, has_owner=True)

    r = await api_client.put(
        f"/api/v1/org/members/{CALLER}/modules",
        json={"modules": [{"code": "vetana", "role": APPROVER}]},
    )

    assert r.status_code == 403, r.text


# ══════════════════════════════════════════════════════════════════════════════
# 6 · The organisation with no owner
#
# `staging.user_roles` grouped by org, measured 2026-08-06:
#
#   045b76ad  org_owner 1  org_admin 2  org_member 6
#   64e7bea6  org_owner 1  org_admin 2  org_member 3
#   fae87907  org_owner 0  org_admin 4  org_member 1   <- Unicode Group
#
# "Only an owner may grant approver" names, for fae87907, a caller that does not
# exist — and cannot be created: nothing in this backend writes an `org_owner`
# row into an existing org (`update_member_role` accepts org_admin/org_member,
# `admin_orgs.assign_role` narrows to INVITABLE_ORG_ROLE = "org_admin", and only
# an owner may invite an owner). That org already holds one live vetana:approver
# row, so the rule as written froze it permanently.
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_the_owner_rule_is_the_default_when_nobody_asked(module):
    """`org_has_owner` defaults to TRUE — the refusing value. A call site that
    forgets to pass it refuses, never admits."""
    refusal = refuse_grant(module, APPROVER, caller_org_role="org_admin")
    assert refusal is not None and refusal.status == 403


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_an_ownerless_org_falls_back_to_its_admins(module):
    assert refuse_grant(
        module, APPROVER, caller_org_role="org_admin", org_has_owner=False,
    ) is None


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_the_fallback_is_only_ever_the_ownerless_case(module):
    """It must not become "admins may do this". With an owner present the rule
    is exactly what it was."""
    assert refuse_grant(
        module, APPROVER, caller_org_role="org_admin", org_has_owner=True,
    ) is not None


def test_the_fallback_does_not_reach_the_shape_half():
    """No owner is not a licence to write a level the module has no use for."""
    refusal = refuse_grant(
        "vetana", "god", caller_org_role="org_admin", org_has_owner=False,
    )
    assert refusal is not None and refusal.status == 400


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_the_predicate_and_the_refusal_are_the_same_condition(module):
    """`grant_needs_owner_authority` decides three things — whether to refuse,
    whether the org's owner must be looked up at all, and whether the audit row
    is flagged. If it could disagree with `refuse_grant` the flag would lie."""
    from middleware.role_tiers import grant_needs_owner_authority

    for role in ("org_owner", "org_admin", "org_member", None):
        needs = grant_needs_owner_authority(module, APPROVER, caller_org_role=role)
        refused = refuse_grant(
            module, APPROVER, caller_org_role=role, org_has_owner=True,
        ) is not None
        assert needs == refused, role


def test_the_ownerless_state_cannot_be_manufactured_to_reach_the_fallback():
    """The property the fallback rests on. If an org_admin could remove or
    demote their owner, they could put the org into the state that lets them
    grant themselves approver — which would be the original hole with an extra
    step."""
    import inspect

    from routers.org_members import remove_member, update_member_role

    removal = inspect.getsource(remove_member)
    assert "role_code='org_owner'" in removal
    assert "Cannot remove an org owner" in removal

    demote = " ".join(inspect.getsource(update_member_role).split())
    assert '{"org_admin", "org_member"}' in demote, \
        "update_member_role can now target a role other than admin/member"
    assert "role_code IN ('org_admin','org_member')" in demote, \
        "the role UPDATE is no longer scoped away from the owner row"


#: The files allowed to write an `org_owner` row, and the reason each may.
#:
#: This assertion used to be "NOBODY writes one", and it was the argument for
#: `role_tiers.refuse_grant`'s no-owner fallback: a refusal whose remedy does
#: not exist is an outage, not a guard. Two remedies now exist, and the
#: tripwire's own instruction was not to delete it but to reconsider the
#: fallback when one appeared. Reconsidered below.
#:
#:   routers/admin_orgs.py   TWO writers, both examined:
#:
#:     · `create_org` seats the FOUNDER as org_owner. It used to hardcode
#:       'org_admin', which is why no organisation could ever have an owner and
#:       why `PATCH /v1/org/modules` was unreachable for every customer. It
#:       writes into an org being created in the same transaction, so it can
#:       never appoint an owner over an existing one.
#:     · `nominate_org_owner` is the bootstrap for orgs that already exist. God
#:       mode only; 409s when the org already has an owner; refuses anybody who
#:       is not already an org_admin OF THAT ORG; inserts and never updates.
#:
#:   auth_router.py          `accept_invite` writes whatever role the INVITE
#:                           carries, and `org_invites._assert_may_grant_role`
#:                           is what decided that an owner could mint it. The
#:                           authority was checked when the invite was created.
_ORG_OWNER_WRITERS = {"routers/admin_orgs.py", "auth_router.py"}


def test_only_the_examined_endpoints_write_an_org_owner_row():
    """The fallback's justification, restated now that a remedy exists.

    `refuse_grant`'s no-owner fallback stays, and the reason has narrowed rather
    than disappeared. Every organisation created from today has an owner, so the
    fallback is dead code for new orgs. It is NOT dead for the ones that already
    exist — measured live on 2026-08-22, Unicode Group holds five org_admins and
    zero owners — and `nominate_org_owner` is an Aekam action, not something an
    org can do for itself. Until an operator has run it for every ownerless org,
    refusing a payroll approver in one of them would still be an outage.

    What this test now guards is the SET of writers. A new file appearing here
    means somebody has found a third way to create the authority that appoints
    payroll approvers, and that is worth reading before it ships.
    """
    import re

    offenders = []
    for path in _sources():
        text = path.read_text(encoding="utf-8-sig", errors="ignore")
        blob = _sql_blob(text)
        for stmt in re.findall(r"insert into staging\.user_roles.{0,400}", blob):
            if "'org_owner'" in stmt:
                offenders.append(path.relative_to(BACKEND).as_posix())

    unexpected = sorted(set(offenders) - _ORG_OWNER_WRITERS)
    assert not unexpected, (
        f"a new endpoint writes an org_owner row: {unexpected}. That is the "
        "authority which appoints payroll approvers — read it, then add it to "
        "_ORG_OWNER_WRITERS with the reason it may."
    )


def test_the_bootstrap_cannot_replace_an_owner_that_exists():
    """`nominate_org_owner` is a bootstrap, and the difference is the 409.

    An endpoint that could appoint an owner over an existing one would let Aekam
    change who runs a customer's organisation. Pinned on the source because the
    guard is a refusal, and this file drives no database.
    """
    import inspect

    from routers.admin_orgs import nominate_org_owner

    src = inspect.getsource(nominate_org_owner)
    assert "SUPERUSER_ONLY_ROLES" in src, "the bootstrap is not god-mode only"
    assert "already has an owner" in src, "the 409 on an existing owner is gone"
    assert "role_code='org_admin'" in src, \
        "the nominee is no longer required to be an administrator of this org"
    # Inserts, never updates: an existing grant is not rewritten to achieve this.
    assert "UPDATE staging.user_roles" not in src


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
async def test_the_ownerless_grant_lands_flagged_in_the_audit_log(
    api_client, org_editor, mock_pool, captured_audit, module,
):
    """A fallback that is invisible afterwards is just a weaker rule. The row
    must say it was allowed because there was no owner."""
    _route_pool(mock_pool, caller_role="org_admin",
                held={"graha": EDITOR}, has_owner=False)

    r = await api_client.put(MODULES_URL, json={"modules": [
        {"code": "graha", "role": EDITOR},
        {"code": module, "role": APPROVER},
    ]})
    assert r.status_code == 200, r.text

    rows = {k["resource_id"]: k for k in captured_audit}
    assert rows[module]["detail"]["no_owner_fallback"] is True
    assert rows[module]["severity"] == "warn"
    # Only the grant that used it. Nothing else in the same save is tainted.
    assert "graha" not in rows, "an unchanged grant wrote an audit row"


async def test_an_owner_granting_it_is_not_flagged_as_a_fallback(
    api_client, org_editor, mock_pool, captured_audit,
):
    """The flag distinguishes "an owner decided this" from "there was no owner
    to decide". If it were set on both it would distinguish nothing."""
    _route_pool(mock_pool, caller_role="org_owner", held={}, has_owner=True)

    r = await api_client.put(MODULES_URL, json={"modules": [
        {"code": "vetana", "role": APPROVER},
    ]})
    assert r.status_code == 200, r.text

    rows = {k["resource_id"]: k for k in captured_audit}
    assert rows["vetana"]["detail"]["no_owner_fallback"] is False
    assert rows["vetana"]["severity"] == "warn"


async def test_the_owner_lookup_is_skipped_when_nothing_turns_on_it(
    api_client, org_editor, mock_pool,
):
    """Every ordinary save would otherwise pay for a `staging.user_roles` read
    it never consults — this endpoint is the member editor, not a cold path."""
    _route_pool(mock_pool, caller_role="org_admin",
                held={"graha": VIEWER}, has_owner=True)

    r = await api_client.put(MODULES_URL, json={"modules": [
        {"code": "graha", "role": EDITOR},
    ]})
    assert r.status_code == 200, r.text

    owner_reads = [
        c for c in mock_pool.fetchval.call_args_list
        if "role_code='org_owner'" in c.args[0]
    ]
    assert owner_reads == []
