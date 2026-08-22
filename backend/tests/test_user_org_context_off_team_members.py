"""Phase 3 of the tenancy retirement: the one live view that named `team_members`.

`PROPOSED_080_team_members_retire` lists four steps before the rename and this
was the third: "Replace staging.user_org_context with a user_roles-based
definition." It is the last thing between the code cutover (phase 2, done) and
the rename, because a rename breaks a view naming the renamed table
immediately — and it breaks it in the catalogue, not at the call site, so the
first symptom is every Sahayak skill that resolves a name failing at once.

── WHAT THE VIEW ACTUALLY WAS ──────────────────────────────────────────────
Narrower than its name, and narrower than anyone had written down. Read off the
live catalogue on 2026-08-22, it joined
`staging.organisations.team_id = team_members.team_id` — the org's FOUNDING team
and no other. So it never described "who is in this organisation"; it described
"who is on the one team the organisation was created around". **12 rows**,
across 3 orgs and 35 users.

That join is also the second, undocumented org path `PROPOSED_080` flags in
passing: `organisations.team_id` runs opposite to `teams.org_id`, two directions
for one relationship. Migration 199 settles it on `teams.org_id`, which is what
`get_visible_team_ids` and `POST /teams` both use and the only one that can
describe an org with more than one project.

── WHY NOT THE SKETCHED REPLACEMENT ────────────────────────────────────────
`PROPOSED_080` sketches a `user_roles`-only view. Measured, it loses two live
people — Devang Bhatt and Rohan Kasti, both on Aekam's founding team with no
`user_roles` row for it — and this view's ONLY job is to put a name on a user
id. Both consumers are name resolvers, so the effect would have been a task
list that says who three of five assignees are, silently. Giving those two
`user_roles` rows to make a view convenient is writing membership into a
customer's organisation, which is not a migration's decision.

So 199 is the UNION of the two paths that survive the retirement: org
membership (`staging.user_roles`) and project membership
(`public.project_assignments` + `public.teams.org_id`). Measured after
applying: 35 rows, 0 lost, 0 people carrying two names in one org, 0 system
accounts named.
"""
import re
from pathlib import Path

import pytest

MIGRATION = (Path(__file__).resolve().parents[1]
             / "migrations" / "199_user_org_context_off_team_members.sql")


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _statements(sql: str) -> str:
    """The migration with its comment lines stripped.

    The header explains the retirement at length and names `team_members`
    repeatedly — including in the rollback, which recreates the old definition
    on purpose. A substring sweep over the raw file would either fail forever or
    force the explanation to be deleted, and the explanation is the part worth
    keeping.
    """
    return "\n".join(
        line for line in sql.splitlines() if not line.lstrip().startswith("--")
    )


def _create_statement(sql: str) -> str:
    """Just the `CREATE VIEW … ;`, and nothing after it.

    The `COMMENT ON VIEW` that follows deliberately says the view "reads no
    team_members", so a slice running to the end of the file would find the
    name in the sentence saying it is not there.
    """
    body = _statements(sql)
    start = body.index("CREATE VIEW staging.user_org_context")
    return body[start:body.index(";", start) + 1]


def test_the_new_definition_does_not_name_team_members(sql):
    """The whole requirement of step 3, in one assertion."""
    assert "team_members" not in _create_statement(sql)


def test_it_reads_both_surviving_paths(sql):
    """A `user_roles`-only view loses two people. See the header."""
    create = _create_statement(sql)
    assert "staging.user_roles" in create
    assert "public.project_assignments" in create
    assert "UNION" in create


def test_the_project_leg_resolves_the_org_through_teams_org_id(sql):
    """NOT `organisations.team_id`, which is the old view's direction and the
    reason it only ever saw the founding team."""
    create = _create_statement(sql)
    assert "t.org_id" in create
    assert "o.team_id" not in create


def test_inactive_organisations_are_excluded_on_both_legs(sql):
    """A deactivated org must not keep resolving names, and a rule applied to
    one leg of a UNION and not the other is a rule that does not hold."""
    create = _create_statement(sql)
    assert create.count("o.is_active = TRUE") == 2


def test_it_is_a_drop_and_create_inside_a_transaction(sql):
    """`CREATE OR REPLACE VIEW` cannot drop a column, and this drops two
    (`team_id`, `role`). The DROP leaves a window where the view does not
    exist; the transaction is what stops a reader seeing a half-built one.
    """
    body = _statements(sql)
    assert "DROP VIEW IF EXISTS staging.user_org_context" in body
    assert body.index("BEGIN") < body.index("DROP VIEW")
    assert body.index("CREATE VIEW") < body.index("COMMIT")


def test_the_rollback_is_present_and_verbatim(sql):
    """`PROPOSED_080` is explicit that every step before the rename stays
    reversible. The rollback recreates the OLD definition, so it is the one
    place in this file that may name `team_members`."""
    tail = sql[sql.index("ROLLBACK"):]
    assert "CREATE VIEW staging.user_org_context" in tail
    assert "team_members" in tail
    assert "tm.status = 'active'" in tail


def test_nothing_in_the_repository_reads_the_dropped_columns():
    """`team_id` and `role` are gone from the view. `PROPOSED_080` warns to
    check consumers first — this is that check, kept.

    Both live consumers select `user_id`, `name` and `org_id` only:
    `services/skills/data/deadline_scanner.py` (assignee names on a deadline
    list) and `workload_calculator.py` (a name beside a workload count).
    """
    backend = Path(__file__).resolve().parents[1]
    offenders = []
    for path in backend.rglob("*.py"):
        if ".venv" in path.parts or "tests" in path.parts:
            continue
        text = path.read_text(encoding="utf-8-sig", errors="ignore")
        if "user_org_context" not in text:
            continue
        # The alias the consumers give the view, then a dropped column off it.
        for alias in re.findall(r"user_org_context\s+(\w+)", text):
            for dropped in ("team_id", "role"):
                if re.search(rf"\b{alias}\.{dropped}\b", text):
                    offenders.append(f"{path.name}: {alias}.{dropped}")
    assert not offenders, (
        "these read a column migration 199 dropped from the view: "
        f"{offenders}"
    )


def test_the_consumers_are_still_only_the_two_that_were_checked():
    """A third consumer appearing means somebody must re-check the shape."""
    backend = Path(__file__).resolve().parents[1]
    readers = sorted(
        path.relative_to(backend).as_posix()
        for path in backend.rglob("*.py")
        if ".venv" not in path.parts and "tests" not in path.parts
        and "user_org_context" in path.read_text(encoding="utf-8-sig", errors="ignore")
    )
    assert readers == [
        "services/skills/data/deadline_scanner.py",
        "services/skills/data/workload_calculator.py",
    ], f"the set of readers has changed: {readers}"
