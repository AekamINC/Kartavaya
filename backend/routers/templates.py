"""
templates.py — Project and task templates (CRUD + apply)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid, json

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import is_platform_staff
from utils import assert_config_attachments

router = APIRouter(prefix="/api/templates", tags=["templates"])

_TEMPLATE_NOT_FOUND = "Template not found"


# ── Shared helpers ───────────────────────────────────────────────────────────────

async def _is_team_member(pool, team_id: str, user_id: str) -> bool:
    """PROJECT membership. One table since migration 195 made
    `project_assignments` a strict superset of active `team_members` at
    identical roles — the dropped leg admitted nobody this one does not.
    Canonical note: `middleware/roles.may_reach_project`."""
    row = await pool.fetchrow("""
        SELECT 1 FROM public.project_assignments WHERE team_id=$1 AND user_id=$2
    """, team_id, user_id)
    return row is not None


async def _assert_team_member(pool, team_id: str, user_id: str):
    if not await _is_team_member(pool, team_id, user_id):
        raise HTTPException(403, "Not a member of this team")


async def _assert_can_modify(pool, tmpl, user):
    """Raise 403 if user may not edit/delete the template row."""
    if await is_platform_staff(user["user_id"]):
        return
    if tmpl["team_id"]:
        await _assert_team_member(pool, tmpl["team_id"], user["user_id"])
    else:
        if tmpl["created_by"] != user["user_id"]:
            raise HTTPException(403, "Not authorised")


# ── Models ───────────────────────────────────────────────────────────────────────

class ProjectTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    config: dict  # {columns, fields, sample_tasks}


class TaskTemplateCreate(BaseModel):
    name: str
    team_id: Optional[str] = None
    config: dict  # {title_pattern, description, priority, default_assignees, ...}


class TaskTemplateBody(BaseModel):
    name: str
    team_id: Optional[str] = None
    icon: str = "📋"
    is_default: bool = False
    config: dict  # title, description, priority, subtasks[], attachments[], tags[], category_id, custom_fields{}


# `config` is `json.dumps`-ed into a JSONB column with nothing looked at on the
# way past, and the comments above are the only statement of what it holds. One
# of those things is `attachments[]` — `{name, url, key}` per entry — so a
# template is a place a file can be posted into the database as a `data:` URI
# with R2 perfectly healthy. `assert_config_attachments` inspects that documented
# shape rather than every string in the blob: a blanket scan refuses a template
# whose *description* explains what a data URI is.


# ── Project templates ─────────────────────────────────────────────────────────────
#
# ── WHAT WAS WRONG, AND IT WAS WRONG IN BOTH DIRECTIONS ──────────────────────
#
# `public.project_templates` had NO tenant column — `template_id, name,
# description, config, created_by, created_at` and nothing else — so these
# handlers scoped it by the only column they had, the AUTHOR. That produced two
# opposite failures from one omission:
#
#   UPWARD.    Platform staff got `SELECT * FROM project_templates` unfiltered:
#              every customer's board layout, custom fields and sample tasks,
#              from one endpoint, with nothing recording that it happened.
#   SIDEWAYS.  Everybody else saw only rows they had authored, so a template one
#              colleague built was invisible to the rest of their own firm. That
#              is the other half of the owner's report — "needs more templates"
#              is not a shortage. The whole database holds ONE project template
#              and FOUR task templates, and each was visible to one person.
#
# And `apply` never checked the template at all: it looked the config up by id
# and wrote columns, field definitions and tasks from it into a project the
# caller does belong to, so any signed-in user could name any template id in the
# product and read its contents through the board it produced.
#
# Migration 200 adds `org_id`, backfilled from the author's earliest org grant.
#
# ── WHY `org_id IS NULL` IS STILL ADMITTED ───────────────────────────────────
#
# A template whose author holds no org grant cannot be attributed, and 200 left
# those NULL rather than refusing to run. Dropping them from every listing would
# make somebody's template vanish on deploy, so a NULL row keeps exactly its old
# behaviour: visible to its author, and to nobody else. Live count of such rows
# today: 0. The branch exists so that number staying 0 is not load-bearing.


def _org_scope(org_id: str, user_id: str) -> tuple[str, list]:
    """The WHERE clause and its parameters for "templates this caller may see".

    One place, because the listing, the delete check and `apply` must agree —
    a template you can apply but cannot see, or see but cannot apply, is worse
    than either rule on its own.
    """
    return (
        "(t.org_id = $1::uuid OR (t.org_id IS NULL AND t.created_by = $2))",
        [org_id, user_id],
    )


@router.get("/projects")
async def list_project_templates(
    pool=Depends(get_pool),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """Every template belonging to the caller's organisation.

    NOT "every template I wrote", and NOT — for platform staff — every template
    in the product. Aekam sees what the org it is acting in sees, which is the
    same rule every other module applies to platform accounts and the only one
    that leaves a record of which org was opened.
    """
    where, params = _org_scope(org_id, user["user_id"])
    rows = await pool.fetch(
        f"SELECT t.* FROM public.project_templates t "
        f"WHERE {where} ORDER BY t.created_at DESC",
        *params,
    )
    return [dict(r) for r in rows]


@router.post("/projects")
async def create_project_template(
    body: ProjectTemplateCreate,
    pool=Depends(get_pool),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    assert_config_attachments(body.config)
    tid = f"ptmpl_{uuid.uuid4().hex[:10]}"
    row = await pool.fetchrow(
        "INSERT INTO public.project_templates "
        "  (template_id, name, description, config, created_by, org_id) "
        "VALUES ($1,$2,$3,$4::jsonb,$5,$6::uuid) RETURNING *",
        tid, body.name, body.description, json.dumps(body.config),
        user["user_id"], org_id,
    )
    return dict(row)


@router.delete("/projects/{template_id}")
async def delete_project_template(
    template_id: str,
    pool=Depends(get_pool),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """Delete a template of your own organisation.

    Two questions, and they are separate: WHICH templates exist for you (the org
    scope) and WHETHER you may remove this one (authorship, or platform staff).
    Collapsing them would let any member of an org delete a colleague's
    template; keeping only the second would 404 rather than 403 across a tenant
    boundary, which tells the caller a template id is real.
    """
    where, params = _org_scope(org_id, user["user_id"])
    tmpl = await pool.fetchrow(
        f"SELECT t.created_by FROM public.project_templates t "
        f"WHERE t.template_id=$3 AND {where}",
        *params, template_id,
    )
    if not tmpl:
        # Also the cross-tenant case, and deliberately the same answer as a
        # template that does not exist: a 403 here would confirm that somebody
        # else's template id is real.
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    if tmpl["created_by"] != user["user_id"] and not await is_platform_staff(user["user_id"]):
        raise HTTPException(403, "Not authorised")
    await pool.execute(
        "DELETE FROM public.project_templates WHERE template_id=$1", template_id,
    )
    return {"ok": True}


@router.post("/projects/{template_id}/apply")
async def apply_project_template(
    template_id: str, team_id: str,
    pool=Depends(get_pool),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """Create columns and sample tasks from template into existing team."""
    if not await is_platform_staff(user["user_id"]):
        await _assert_team_member(pool, team_id, user["user_id"])
        # `_assert_team_member` has no role filter, and this route INSERTs
        # columns, field definitions and tasks wholesale into somebody else's
        # project. Membership is not a licence to reshape the board.
        from services.task_actor import assert_may_write_task
        await assert_may_write_task(pool, team_id=team_id, user=user)

    # ── THE TEMPLATE IS SCOPED TOO, and it never was ─────────────────────────
    #
    # This read was `WHERE template_id=$1` and nothing else. The gate above
    # proves the caller may write to the DESTINATION project; it says nothing
    # about the SOURCE. So any signed-in user could name any template id in the
    # product and have its columns, its custom field definitions and its sample
    # task titles written into a board they own — reading another firm's
    # template through the artefact it produced.
    where, params = _org_scope(org_id, user["user_id"])
    tmpl = await pool.fetchrow(
        f"SELECT t.config FROM public.project_templates t "
        f"WHERE t.template_id=$3 AND {where}",
        *params, template_id,
    )
    if not tmpl:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    cfg = tmpl["config"] if isinstance(tmpl["config"], dict) else json.loads(tmpl["config"])
    created = {"columns": 0, "fields": 0, "tasks": 0}
    skipped = {"columns": 0, "fields": 0, "tasks": 0}

    # ── APPLY IS IDEMPOTENT BY NAME, AND IT WAS NOT ──────────────────────────
    #
    # MEASURED on `S3 Project 05`, 2026-08-29: `To Do`, `In Progress`,
    # `In Review`, `Approval` and `Done` each existed TWICE, at the SAME
    # `sort_order` — (0,0) (1,1) (2,2) (3,3) (4,4). The board was doubled AND its
    # ordering was ambiguous. It closes exactly across the org: 4x9 + 3x14 +
    # 1x5 = 83 rows. A new customer applies a template, does not see it land,
    # applies it again, and now owns a kanban board with two "In Progress"
    # columns in an order the database cannot decide.
    #
    # THE `ON CONFLICT DO NOTHING` THAT USED TO BE HERE COULD NEVER FIRE. It
    # guarded `column_id`, which is minted fresh from `uuid4` on the line above
    # — a key that is new every time has no conflict to do nothing about. It
    # read as protection and was none. It is gone rather than kept, because the
    # only collision it could ever actually catch is a `uuid4().hex[:10]`
    # birthday collision, and silently dropping a column on one of those is
    # worse than the 500 that now happens: a 500 is reported, a missing column
    # is discovered weeks later by the person who cannot find their work.
    #
    # ⚠ COLUMNS LIVE IN `public.project_columns`. Not `board_columns` — and both
    # `public.boards` and `public.board_columns` hold ZERO rows in the whole
    # database, so a query against those will report that there is no problem.
    #
    # WHY IDEMPOTENT-BY-NAME rather than "refuse on a non-empty board":
    # refusing would break the legitimate case of adding a template's columns to
    # a project that already has one or two of its own, and a new customer's
    # project is very often exactly that. Applying twice is almost always an
    # accident; applying to a partly-built board is not. So a name that is
    # already there is left ALONE — its colour, its `is_done` flag and its
    # position are the customer's, not the template's, and a second apply must
    # not reach in and overwrite choices somebody made.
    #
    # WHY NO UNIQUE INDEX: `UNIQUE (team_id, lower(name))` is the durable fix
    # and it cannot be created — the duplicates above already exist, so the
    # migration would fail on live data. Repairing them is a DATA CHANGE to live
    # rows and therefore the owner's decision, recorded as finding 19. This
    # stops the bleeding; it does not clean the floor.

    def _key(s) -> str:
        """Match names the way a person reads them, not the way bytes compare.

        A template's "To Do" and a board's "to do " are the same column to
        everybody except `=`. Trailing space is what a paste produces.
        """
        return " ".join(str(s or "").split()).casefold()

    # ── Columns ──────────────────────────────────────────────────────────────
    col_rows = await pool.fetch(
        "SELECT name, sort_order FROM project_columns WHERE team_id=$1", team_id,
    )
    have_cols = {_key(r["name"]) for r in col_rows}
    # New columns go AFTER whatever is already on the board. `sort_order` was
    # the loop index, which is how two columns ended up sharing a position: on
    # the second apply the template restarted its own numbering at 0 on top of a
    # board that already used 0..4. `-1 + 1` gives 0 on an empty board.
    next_sort = max(
        (r["sort_order"] for r in col_rows if r["sort_order"] is not None),
        default=-1,
    ) + 1

    for col in cfg.get("columns", []):
        key = _key(col["name"])
        # `have_cols` is added to inside the loop as well, so a template that
        # itself lists the same column name twice writes it once — that would
        # otherwise duplicate a board in a SINGLE apply, which no amount of
        # re-run protection would catch.
        if not key or key in have_cols:
            skipped["columns"] += 1
            continue
        col_id = f"col_{uuid.uuid4().hex[:10]}"
        await pool.execute(
            "INSERT INTO project_columns (column_id, team_id, name, color, sort_order, is_done, org_id) "
            "VALUES ($1,$2,$3,$4,$5,$6,(SELECT org_id FROM teams WHERE team_id=$2))",
            col_id, team_id, col["name"], col.get("color", "#0082c6"),
            next_sort, col.get("is_done", False),
        )
        have_cols.add(key)
        next_sort += 1
        created["columns"] += 1

    # ── Custom fields ────────────────────────────────────────────────────────
    #
    # `sort_order` was the literal 0 for EVERY field — not the loop index, the
    # constant. So a template with four fields wrote four rows all claiming
    # position 0, and the order they came back in was whatever the planner felt
    # like. That is the same ambiguity as the columns, present from the first
    # apply rather than the second, and it is fixed here for the same reason.
    field_rows = await pool.fetch(
        "SELECT name, sort_order FROM field_definitions WHERE team_id=$1", team_id,
    )
    have_fields = {_key(r["name"]) for r in field_rows}
    next_field_sort = max(
        (r["sort_order"] for r in field_rows if r["sort_order"] is not None),
        default=-1,
    ) + 1

    for field_cfg in cfg.get("fields", []):
        key = _key(field_cfg["name"])
        if not key or key in have_fields:
            skipped["fields"] += 1
            continue
        fid = f"fld_{uuid.uuid4().hex[:10]}"
        await pool.execute(
            "INSERT INTO field_definitions (field_id, team_id, name, type, config, sort_order, org_id) "
            "VALUES ($1,$2,$3,$4,$5::jsonb,$6,(SELECT org_id FROM teams WHERE team_id=$2))",
            fid, team_id, field_cfg["name"], field_cfg["type"],
            json.dumps(field_cfg.get("config", {})), next_field_sort,
        )
        have_fields.add(key)
        next_field_sort += 1
        created["fields"] += 1

    # ── Sample tasks ─────────────────────────────────────────────────────────
    #
    # Asked per task rather than by fetching every title on the team: a template
    # carries a handful of sample tasks and a real project carries thousands of
    # rows, so the set-membership shape used for columns above would pull the
    # whole board's titles across to check five strings.
    #
    # `$2::text` is DEFENSIVE, not required — and that was worth finding out
    # rather than asserting. Removing it and re-planning the statement against
    # the live server, Postgres still infers `text`: `btrim` has one single-
    # argument candidate, so an unknown resolves to it without help. This is NOT
    # the `$1::int + $2::int` shape the conventions warn about, where two
    # candidates make the expression genuinely ambiguous and PgBouncer turns the
    # untyped parse into an instant 500. The cast stays because it costs nothing
    # and says what is meant; the claim that it is load-bearing does not, and
    # `test_the_duplicate_check_binds_the_title_as_text` pins the type the
    # SERVER infers rather than the characters in the string.
    for task_cfg in cfg.get("sample_tasks", []):
        title = task_cfg.get("title") or ""
        dup = await pool.fetchrow(
            "SELECT 1 FROM tasks WHERE team_id=$1 "
            "AND lower(btrim(title)) = lower(btrim($2::text)) LIMIT 1",
            team_id, title,
        )
        if not title.strip() or dup:
            skipped["tasks"] += 1
            continue
        task_id = f"task_{uuid.uuid4().hex[:10]}"
        await pool.execute(
            "INSERT INTO tasks (task_id, team_id, created_by_user_id, title, description, status, priority, org_id) "
            "VALUES ($1,$2,$3,$4,$5,'todo','medium',(SELECT org_id FROM teams WHERE team_id=$2))",
            task_id, team_id, user["user_id"],
            title, task_cfg.get("description", ""),
        )
        created["tasks"] += 1

    # `created` now counts what was WRITTEN. It used to be incremented once per
    # item in the config whatever the database did, so it reported the size of
    # the template rather than the effect of the call — and the page turns it
    # straight into "Applied — 5 columns created". `skipped` is returned beside
    # it so that screen can say "already there" instead of "0 created", which a
    # customer reads as a failure.
    return {"ok": True, "created": created, "skipped": skipped}


# ── Task templates ───────────────────────────────────────────────────────────────

@router.get("/tasks")
async def list_task_templates(
    team_id: Optional[str] = None,
    pool=Depends(get_pool),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """Task templates for the caller's ACTIVE organisation.

    ── THE ORG PREDICATE, WHICH THIS ROUTE DID NOT HAVE ─────────────────────

    MEASURED 2026-08-29 against staging, with `X-Org-Id` naming **Unicode
    Group** and an ORG-SCOPED token:

        GET /api/templates/tasks
        → ttmpl_4910d50bdd "Video Shoot"    team_95beaa7529a9  org 045b76ad
          ttmpl_d4c780228d "Kartavya-Issue" team_95beaa7529a9  org 045b76ad

    `045b76ad` is **Aekam Inc**. Unicode Group holds no task template at all,
    and the New Task modal on a Unicode board offered two of the vendor's, by
    name, with their titles, descriptions, subtasks and attachment links inside
    them.

    The no-team branch below scoped by PROJECT MEMBERSHIP alone — "every
    template on every project I am on" — which is a union across organisations,
    not a tenancy predicate. The caller here holds a `client` seat on one Aekam
    project and `org_admin` of Unicode; the union handed Aekam's templates to a
    Unicode screen. This is the same shape as the `create_deal` sweep and the
    same shape `navConfig` records for the sidebar: a role question answered
    over the union of every org instead of over the active one.

    `list_project_templates` beside it already got this right and its docstring
    states the rule — "Aekam sees what the org it is acting in sees" — so the
    fix here is to hold the same line rather than invent a second one, INCLUDING
    for platform staff, whose all-rows branch was the widest version of the same
    fault.

    Org-wide templates (`team_id IS NULL`, and therefore `org_id IS NULL`, which
    only platform staff can create) stay visible to everyone: they are the
    product's own, not a tenant's.
    """
    is_staff = await is_platform_staff(user["user_id"])

    if team_id:
        # The team pins the organisation, so no separate org predicate is
        # needed — and `_assert_team_member` is what stops a caller naming
        # somebody else's project here.
        if not is_staff:
            await _assert_team_member(pool, team_id, user["user_id"])
        rows = await pool.fetch("""
            SELECT * FROM task_templates
            WHERE team_id=$1 OR team_id IS NULL
            ORDER BY is_default DESC, created_at ASC
        """, team_id)
    elif is_staff:
        rows = await pool.fetch("""
            SELECT * FROM task_templates
            WHERE org_id = $1::uuid OR (org_id IS NULL AND team_id IS NULL)
            ORDER BY is_default DESC, created_at ASC
        """, org_id)
    else:
        rows = await pool.fetch("""
            SELECT DISTINCT tt.* FROM task_templates tt
            LEFT JOIN (
                -- PROJECT membership; see `_is_team_member` above for why
                -- `project_assignments` alone is the whole set.
                SELECT team_id FROM public.project_assignments WHERE user_id=$1
            ) my_teams ON my_teams.team_id = tt.team_id
            WHERE (tt.org_id = $2::uuid OR (tt.org_id IS NULL AND tt.team_id IS NULL))
              AND (tt.team_id IS NULL OR my_teams.team_id IS NOT NULL)
            ORDER BY tt.is_default DESC, tt.created_at ASC
        """, user["user_id"], org_id)
    return [dict(r) for r in rows]


@router.get("/tasks/{template_id}")
async def get_task_template(template_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    row = await pool.fetchrow("SELECT * FROM task_templates WHERE template_id=$1", template_id)
    if not row:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    if row["team_id"] and not await is_platform_staff(user["user_id"]):
        await _assert_team_member(pool, row["team_id"], user["user_id"])
    return dict(row)


@router.post("/tasks")
async def create_task_template(body: TaskTemplateBody, pool=Depends(get_pool), user=Depends(require_user)):
    assert_config_attachments(body.config)
    is_staff = await is_platform_staff(user["user_id"])
    if not body.team_id and not is_staff:
        raise HTTPException(403, "Only platform staff can create org-wide templates")
    if body.team_id and not is_staff:
        await _assert_team_member(pool, body.team_id, user["user_id"])
    tid = f"ttmpl_{uuid.uuid4().hex[:10]}"
    if body.is_default and body.team_id:
        await pool.execute("UPDATE task_templates SET is_default=FALSE WHERE team_id=$1", body.team_id)
    row = await pool.fetchrow(
        """INSERT INTO task_templates (template_id, team_id, name, icon, is_default, config, created_by, org_id)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,(SELECT org_id FROM teams WHERE team_id=$2)) RETURNING *""",
        tid, body.team_id, body.name, body.icon, body.is_default,
        json.dumps(body.config), user["user_id"]
    )
    return dict(row)


@router.patch("/tasks/{template_id}")
async def update_task_template(template_id: str, body: TaskTemplateBody, pool=Depends(get_pool), user=Depends(require_user)):
    assert_config_attachments(body.config)
    tmpl = await pool.fetchrow("SELECT created_by, team_id FROM task_templates WHERE template_id=$1", template_id)
    if not tmpl:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    await _assert_can_modify(pool, tmpl, user)
    if body.is_default and tmpl["team_id"]:
        await pool.execute(
            "UPDATE task_templates SET is_default=FALSE WHERE team_id=$1 AND template_id!=$2",
            tmpl["team_id"], template_id
        )
    row = await pool.fetchrow("""
        UPDATE task_templates
        SET name=$1, icon=$2, is_default=$3, config=$4::jsonb, updated_at=NOW()
        WHERE template_id=$5 RETURNING *
    """, body.name, body.icon, body.is_default, json.dumps(body.config), template_id)
    return dict(row)


@router.post("/tasks/{template_id}/set-default")
async def set_default_template(template_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    tmpl = await pool.fetchrow("SELECT team_id FROM task_templates WHERE template_id=$1", template_id)
    if not tmpl:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    if not await is_platform_staff(user["user_id"]):
        # PROJECT role. This one read `team_members` ONLY — no
        # `project_assignments` leg at all — so a project owner seated by the
        # newer table was refused the default-template switch on their own
        # project. Migration 195 makes the single table the complete answer
        # rather than the narrower half of it.
        member = await pool.fetchrow(
            "SELECT role FROM public.project_assignments "
            "WHERE team_id=$1 AND user_id=$2 LIMIT 1",
            tmpl["team_id"], user["user_id"]
        )
        if not member or member["role"] not in ("owner", "admin"):
            raise HTTPException(403, "Only team owners/admins can change the default template")
    if tmpl["team_id"]:
        await pool.execute(
            "UPDATE task_templates SET is_default=(template_id=$1) WHERE team_id=$2",
            template_id, tmpl["team_id"]
        )
    return {"ok": True}


@router.delete("/tasks/{template_id}")
async def delete_task_template(template_id: str, pool=Depends(get_pool), user=Depends(require_user)):
    tmpl = await pool.fetchrow("SELECT created_by, team_id FROM task_templates WHERE template_id=$1", template_id)
    if not tmpl:
        raise HTTPException(404, _TEMPLATE_NOT_FOUND)
    await _assert_can_modify(pool, tmpl, user)
    await pool.execute("DELETE FROM task_templates WHERE template_id=$1", template_id)
    return {"ok": True}
