"""Inbox 8: project templates leaked upward and hid sideways, from one omission.

`public.project_templates` had NO tenant column. Read off the live catalogue on
2026-08-22 its whole shape was `template_id, name, description, config,
created_by, created_at` — so `routers/templates.py` scoped it by the only column
it had, the AUTHOR, and that was wrong in both directions at once:

  UPWARD    platform staff got `SELECT * FROM project_templates`, unfiltered:
            every customer's board layout, custom fields and sample tasks, from
            one endpoint, with nothing recording that it happened.
  SIDEWAYS  everybody else saw only rows they had authored, so a template one
            colleague built was invisible to the rest of their own firm.

That second half is the other half of the owner's report. "Needs more
templates" is not a shortage: the whole database holds ONE project template and
FOUR task templates, and each of them was visible to exactly one person.

And the third, which nobody had reported because it leaves no trace on any
screen: `POST /projects/{template_id}/apply` never checked the template at all.
It read the config by id and wrote columns, field definitions and sample tasks
from it into a project the caller does belong to. The gate proves the caller may
write to the DESTINATION; it said nothing about the SOURCE. So any signed-in
user could name any template id in the product and read another firm's template
through the board it produced.

Migration 200 adds `org_id`, backfilled from the author's earliest org grant —
the same resolution `middleware/org_resolver` falls back to with no `X-Org-Id`
header. Live after applying: 1 row, 1 attributed, 0 unattributable, 0 naming an
org that does not exist.
"""
import inspect
import re

import pytest

from routers import templates


def _code(fn) -> str:
    return "\n".join(
        line for line in inspect.getsource(fn).splitlines()
        if not line.lstrip().startswith("#")
    )


# ── Every reader is scoped, and by the same clause ──────────────────────────

@pytest.mark.parametrize("fn", [
    templates.list_project_templates,
    templates.delete_project_template,
    templates.apply_project_template,
])
def test_every_project_template_read_is_org_scoped(fn):
    code = _code(fn)
    assert "_org_scope(" in code, f"{fn.__name__} does not scope by organisation"


@pytest.mark.parametrize("fn", [
    templates.list_project_templates,
    templates.create_project_template,
    templates.delete_project_template,
    templates.apply_project_template,
])
def test_every_project_template_handler_resolves_an_org(fn):
    assert "org_id" in inspect.signature(fn).parameters, \
        f"{fn.__name__} cannot know which organisation it is acting in"


def test_the_scope_clause_exists_once():
    """The listing, the delete check and `apply` must agree. A template you can
    apply but cannot see — or see but cannot apply — is worse than either rule
    on its own."""
    where, params = templates._org_scope("org-1", "user-1")
    assert "t.org_id = $1::uuid" in where
    assert params == ["org-1", "user-1"]


def test_a_null_org_row_stays_visible_to_its_author_and_to_nobody_else():
    """Migration 200 left unattributable rows NULL rather than refusing to run.
    Dropping them from every listing would make somebody's template vanish on
    deploy; showing them to the org would be the leak, one row at a time."""
    where, _ = templates._org_scope("org-1", "user-1")
    assert "t.org_id IS NULL AND t.created_by = $2" in where


# ── The unfiltered platform read is gone ────────────────────────────────────

def test_platform_staff_no_longer_read_every_template_in_the_product():
    code = _code(templates.list_project_templates)
    assert "is_platform_staff" not in code, \
        "the listing branches on platform staff again — that branch WAS the leak"
    assert "SELECT * FROM project_templates" not in code


def test_no_handler_reads_the_table_unqualified_or_unscoped():
    """A bare `WHERE template_id=$1` is how `apply` came to read across tenants.

    Every SELECT against this table must carry the org clause. `git grep` would
    catch a new file; this catches a new handler in this one.
    """
    src = inspect.getsource(templates)
    for stmt in re.findall(r"FROM public\.project_templates.{0,400}", src, re.S):
        if "SELECT" not in stmt and "DELETE" not in stmt:
            continue
        assert "{where}" in stmt or "_org_scope" in stmt or "template_id=$1" not in stmt, \
            f"an unscoped read of project_templates: {stmt[:120]!r}"


# ── Apply reads the SOURCE, not only the destination ────────────────────────

def test_apply_scopes_the_template_as_well_as_the_project():
    """The gate above it proves the caller may write to the destination. It says
    nothing about where the config came from."""
    code = _code(templates.apply_project_template)
    # The destination gate, unchanged.
    assert "_assert_team_member" in code
    assert "assert_may_write_task" in code
    # And the source, which is new.
    assert "_org_scope(" in code
    assert code.index("_org_scope(") > code.index("assert_may_write_task")


def test_a_template_in_another_org_answers_404_and_not_403():
    """A 403 confirms that somebody else's template id is real. The same answer
    as "no such template" is the one that says nothing."""
    for fn in (templates.delete_project_template, templates.apply_project_template):
        code = _code(fn)
        assert "_TEMPLATE_NOT_FOUND" in code


def test_delete_still_asks_authorship_separately_from_scope():
    """Two questions: WHICH templates exist for you, and WHETHER you may remove
    this one. Collapsing them lets any member of an org delete a colleague's
    template."""
    code = _code(templates.delete_project_template)
    assert 'tmpl["created_by"] != user["user_id"]' in code
    assert "403" in code


# ── The write stamps the org ────────────────────────────────────────────────

def test_creating_a_template_records_which_organisation_it_belongs_to():
    code = _code(templates.create_project_template)
    insert = re.search(r"INSERT INTO public\.project_templates.{0,300}", code, re.S)
    assert insert, "the insert is no longer recognisable"
    assert "org_id" in insert.group(0)
    assert "$6::uuid" in insert.group(0), "the org id is not cast"


# ── The migration itself ────────────────────────────────────────────────────

def test_the_backfill_takes_the_authors_earliest_grant():
    """The same resolution `org_resolver` falls back to when no `X-Org-Id`
    header is sent. A later grant would file a template under an org its author
    joined afterwards."""
    from pathlib import Path

    sql = (Path(__file__).resolve().parents[1]
           / "migrations" / "200_project_templates_org_scope.sql").read_text(encoding="utf-8")
    body = "\n".join(l for l in sql.splitlines() if not l.lstrip().startswith("--"))
    assert "ORDER BY r.granted_at" in body
    assert "LIMIT 1" in body
    # Fills NULLs only — a value set by the application is never overwritten by
    # a re-run.
    assert "WHERE t.org_id IS NULL" in body
    # And the column is nullable: an unattributable row must not fail the run.
    assert "ADD COLUMN IF NOT EXISTS org_id uuid;" in body
    assert "NOT NULL" not in body.split("ADD COLUMN IF NOT EXISTS org_id")[1][:80]
