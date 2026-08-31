"""The project status report must read the model the product actually uses.

── Three defects in one route, each fatal on its own ─────────────────────────

`POST /v1/documents/projects/{id}/report/pdf` answered 404 for EVERY project in
the product. "Download report" is a shipped, enabled, visible button
(`ProjectBoardPage.jsx:324`), and it had never once produced a file.

1. IT READ AN ABANDONED TABLE.
   `documents.py:830` was
       SELECT board_id, name FROM public.boards WHERE board_id=$1 AND team_id=$2
   `public.boards` holds ZERO rows and has NO INSERT anywhere in `backend/` —
   the table cannot gain one through the product. `templates.py:257` already
   records that columns live in `public.project_columns`, "Not `board_columns`".
   Live: boards 0 · board_columns 0 · project_columns 274.

2. IT ASSUMED ONE TEAM PER ORGANISATION.
   `SELECT team_id FROM public.organisations WHERE id=$org` returns a single
   team. Unicode Group has 9 and Aekam Inc has 30, so the predicate became
   `board_id = <project A> AND team_id = <project B>`. Even a perfectly seeded
   `boards` table would still have 404'd for 8 of Unicode's 9 projects and 29 of
   Aekam's 30.

3. AND PAST THE 404, THE FIGURES WOULD HAVE BEEN ZERO.
   The task counts filtered on `board_id`, which is NULL on all 378 task rows.
   Measured against production, old predicate vs new:

       Aekam Inc        0  ->  13 open
       S3 Project 01    0  ->  25 open
       S3 Project 02    0  ->  14 open

   A report that renders is worse than one that 404s if every number on it is
   structurally zero — the reader has no way to tell it apart from a quiet month.

── What the model actually is ────────────────────────────────────────────────

A project IS a team. `ProjectBoardPage.jsx:84` takes `projectId` from the route
and calls `/teams/{projectId}` with it before posting it here, so the id in the
path is a `teams.team_id`. Tasks are keyed on `team_id` — 336 of 378 carry one,
none carries a `board_id` — and `public.teams` has its own `org_id`, which is
what keeps the lookup org-safe now that one organisation legitimately holds many
teams.
"""
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "routers" / "documents.py"


def _code() -> str:
    """The file with comments stripped.

    ⚠ COMMENTS ARE STRIPPED BEFORE MATCHING. Twice in this codebase a
    source-reading assertion passed by matching its own explanatory prose, and
    both are recorded in STATUS.md. The comments around this fix quote the old
    SQL verbatim, so leaving them in would satisfy every assertion below.
    """
    return "\n".join(
        line for line in SRC.read_text(encoding="utf-8").splitlines()
        if not line.strip().startswith("#")
    )


def _teams_lookup(code: str) -> str:
    """Just the WHERE of the `public.teams` lookup, and nothing else.

    ⚠ A FILE-WIDE `in` CHECK IS NOT A CHECK. `org_id=$2::uuid` appears in
    several handlers here, so asserting it against the whole file passed with
    the clause deleted from this statement. The window has to be the statement.
    """
    i = code.index("FROM public.teams")
    tail = code[i:]
    end = tail.index(",\n")          # the arg list that closes the fetchrow
    return tail[:end]

def test_the_report_does_not_read_the_abandoned_boards_table():
    """⚠ `public.boards` HAS NO INSERT PATH. Reading it can only ever 404."""
    code = _code()
    assert "FROM public.boards" not in code, (
        "the project report is reading `public.boards` again. That table holds "
        "zero rows, has no INSERT anywhere in backend/, and cannot gain one "
        "through the product — so every 'Download report' press 404s."
    )


def test_the_project_is_resolved_from_teams_scoped_by_its_own_org():
    """One org has MANY teams; resolving via `organisations.team_id` cannot work."""
    code = _code()
    # ⚠ SCOPED TO THE STATEMENT, NOT THE FILE. Asserting `"org_id=$2::uuid" in
    # code` passed even with the clause DELETED, because that fragment occurs in
    # other handlers in this same file — the assertion was satisfied by an
    # unrelated line. Caught by mutation, which is the only reason it is not
    # still here reading green over a tenancy hole.
    assert "FROM public.teams" in code, "the project lookup left `public.teams`"
    lookup = _teams_lookup(code)
    assert "org_id" in lookup, (
        "the project lookup no longer scopes by the team's own org_id. Unicode "
        "Group has 9 teams and Aekam Inc 30, so `SELECT team_id FROM "
        "organisations` picks the wrong one for all but one — and without an "
        "org filter here, any org could pull another org's report by id.\n"
        "  statement: %r" % lookup
    )
    assert "SELECT team_id FROM public.organisations WHERE id=$1::uuid" not in code, (
        "the one-team-per-organisation assumption is back. It 404s for 8 of "
        "Unicode's 9 projects and 29 of Aekam Inc's 30."
    )


def test_task_counts_are_keyed_on_team_not_board():
    """`tasks.board_id` is NULL on every row, so it filtered everything out."""
    code = _code()
    assert "WHERE k.board_id=$2" not in code, (
        "the time-entries join filters on `tasks.board_id` again — NULL on all "
        "378 rows, so the report's hours line is structurally 0.0."
    )
    assert "FROM public.tasks WHERE board_id=$1 AND team_id=$2" not in code, (
        "the task counts filter on `board_id` again. Live, that predicate "
        "returns 0 for every project; `team_id` returns 13, 25 and 14 for the "
        "first three."
    )


def test_the_org_scope_survived_the_change():
    """⚠ THE ASSERTION THAT STOPS THIS FIX BECOMING A TENANCY HOLE.

    Dropping `organisations.team_id` removed one org check, so the replacement
    has to carry its own. Without `org_id` on the teams lookup, any org could
    pull any other org's project report by id — which would be a far worse
    defect than the 404 this replaced.
    """
    lookup = _teams_lookup(_code())
    assert "org_id" in lookup, (
        "the project lookup no longer filters on org_id, so a team id from "
        "another organisation would resolve: %r" % lookup
    )
    assert "deleted_at IS NULL" in lookup, (
        "a deleted project still resolves for reporting: %r" % lookup
    )
