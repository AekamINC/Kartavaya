"""
search.py — `GET /api/search`, the command palette's record search.

── Why this file exists ──────────────────────────────────────────────────────

`components/CommandPalette.jsx` has been calling `GET /api/search` since the
redesign landed. Nothing served it. The palette was written to survive that —
it keeps a module-level tri-state (`unknown → live | absent`) and stops asking
after one 404 — so the symptom was not an error but a silence: type a client's
name into ⌘K and only the 30 static commands answered.

── The shape is dictated by the caller, not invented here ────────────────────

`lib/commands.js` `ENTITIES` is the contract. Each group renders with a fixed
title/meta accessor, so the keys below are not negotiable:

    tasks     {id, title, project, status, route}
    clients   {id, name, gstin, route}
    invoices  {id, number, client, status, route}
    messages  {id, snippet, author, channel, route}
    files     {id, name, task, route}

plus `counts` — `{tasks: n, …}` — which the palette reads to render "3 of 23".
A count computed over a wider set than the rows would leak the size of data the
caller cannot see, so **the count runs the same predicate as the rows**, org
boundary included. That is the whole reason it is a second query rather than a
window function over an unfiltered scan.

`route` is returned per hit because the palette falls back to the module page
otherwise (`ENTITIES[].route`), and landing on `/graha` when you searched for
one client is the "link to nowhere" the handover keeps flagging. Today the only
honest deep link available is a task's own board — `App.jsx` has
`/projects/:projectId` but no `/tasks/:id`, and the module pages hold their tab
in local state with no query-param reader. So `route` is a REAL route in every
case; when a finer one exists it is used, and when it does not, the module page
is returned deliberately rather than a fabricated `/graha?client=<uuid>` that
would fall through to the catch-all and redirect to the dashboard.

── Authorisation ─────────────────────────────────────────────────────────────

Search is a customer-facing surface: every org member uses ⌘K. It therefore
authenticates with `require_user` and authorises exactly the way the module it
is searching does — it must never be able to surface a row the caller could not
already open.

  · Per-entity module access reuses `middleware.subscription.require_module`
    ITSELF, called directly rather than reimplemented. That dependency is the
    only place that knows about platform-role reach (`role_tiers.can_reach_module`),
    sensitive-module auditing, per-user `org_member_modules` grants and the
    subscription state. A second copy of that logic here would drift, and the
    direction it drifts in is "search shows you payroll".
  · A refused module is SKIPPED, not fatal — one ungranted module must not
    blank the palette. Refused groups are reported in `unavailable` so the
    caller can tell "nothing matched" from "not yours to see".
  · Tasks and files carry no module gate (core PM is not in
    `module_subscriptions`) and are scoped by `get_visible_team_ids`, the same
    helper every task read uses, then NARROWED to the active org.

NO ROLE STRING APPEARS IN THIS FILE. Where a privilege decision is needed it is
delegated to `middleware.roles.is_org_admin` / `require_module`, which read
`staging.user_roles` and `middleware.role_tiers`. See the audit note in
`API_CONTRACT_AUDIT.md` §"RBAC deviation" for why this is `require_user` and
not `require_platform_role`: gating ⌘K behind a platform-console role set would
make record search reachable by Aekam staff only and dead for every customer,
which is the opposite of what the four-tier model is for.

── The org boundary ──────────────────────────────────────────────────────────

`get_visible_team_ids` answers "which teams may this user see", which for an
org admin expands to their own org and for platform staff can expand to every
team in the database. Search then intersects that with the ACTIVE org: a team
carrying a different `org_id` is dropped. Legacy teams with `org_id IS NULL`
are kept, because narrowing them away would empty search for every org that
predates the org column — and keeping them widens nothing, since they were
already in the caller's own grant list.

── Matching, and the honest state of it ──────────────────────────────────────

`to_tsvector('simple', …)` — never `'english'`. The english config stems and
stopword-strips, and "Rai" or "है" are not English words; `simple` folds case
using Unicode rules and splits on non-word characters, which is what a name
search across Latin, Devanagari and Gujarati actually needs.

The query is compiled to a prefix `tsquery` (`rakes:*`) built from tokens
sanitised in Python with `str.isalnum()` — Unicode-aware, so `राकेश` survives
where a `[a-z0-9]` regex would delete it. `plainto_tsquery` is not used: it
cannot express a prefix, and the palette searches from two characters, where
every useful match IS a prefix. An `ILIKE` arm runs alongside for infix matches
(`gst` inside a GSTIN) — `pg_trgm` is installed and indexes that pattern class.

`unaccent` IS NOT INSTALLED ON THIS DATABASE (checked: pg_extension holds
pg_trgm, pgcrypto, vector, uuid-ossp, pg_stat_statements, supabase_vault,
plpgsql). Installing it is a migration and migrations are out of scope here —
and staging and production share one Supabase project, so it is not a change to
make in passing. This module therefore DETECTS it, once, and folds accents when
it is there. Two things are worth stating rather than leaving implied:

  · Without it, "Jose" does not find "José". With it, it does.
  · Even WITH it, `unaccent`'s default rules do not decompose Devanagari or
    Gujarati matras — those are separate code points, not accents. Bilingual
    matching here comes from `simple` + prefix tsquery, not from unaccent. The
    extension is worth adding for Latin diacritics; it is not what makes
    Devanagari work, and this file does not pretend otherwise.

── Failure isolation ─────────────────────────────────────────────────────────

Every entity runs inside its own try/except and a missing relation degrades
that group to `unavailable` instead of 500-ing the request. This is not
defensive padding: `staging.samvada_*` and `staging.varta_*` DO NOT EXIST on
this database (see `API_CONTRACT_AUDIT.md` Appendix B), so the messages group
would take the whole palette down on the first keystroke without it.
"""
from __future__ import annotations

import logging
import unicodedata
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import is_org_admin
from middleware.subscription import require_module

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["search"])

#: Entity key → the module code whose grant governs it. Keys absent from this
#: map are ungated (core PM). The codes are the same strings
#: `middleware/role_tiers.py` enumerates in `ALL_MODULES`; they are passed to
#: `require_module`, which is the only thing that interprets them.
_ENTITY_MODULE: dict[str, str] = {
    "clients": "graha",
    "invoices": "ganit",
    "messages": "sanvaad",
}

#: Render order, and the set the caller may scope to. Matches `SCOPES` /
#: `ENTITIES` in `frontend/src/lib/commands.js`.
_ENTITIES: tuple[str, ...] = ("tasks", "clients", "invoices", "messages", "files")

#: Per-group cap. The palette asks for 5; anything larger is a caller mistake
#: rather than a request worth serving, because five groups × N rows is the
#: real cost and this endpoint fires on a 180ms debounce.
_MAX_LIMIT = 20

_MIN_QUERY = 2

# Resolved once per process on first use. `None` = not yet checked.
_UNACCENT: Optional[bool] = None
#: relation name → bool. Guards groups whose tables were never created.
_RELATION_CACHE: dict[str, bool] = {}


async def _has_unaccent(pool) -> bool:
    global _UNACCENT
    if _UNACCENT is None:
        try:
            _UNACCENT = bool(
                await pool.fetchval("SELECT 1 FROM pg_extension WHERE extname = 'unaccent'")
            )
        except Exception:  # pragma: no cover — catalog read should not fail
            _UNACCENT = False
    return _UNACCENT


async def _relation_exists(pool, qualified: str) -> bool:
    """True if `schema.table` is a real relation. Cached for the process."""
    if qualified not in _RELATION_CACHE:
        try:
            _RELATION_CACHE[qualified] = bool(
                await pool.fetchval("SELECT to_regclass($1) IS NOT NULL", qualified)
            )
        except Exception:
            _RELATION_CACHE[qualified] = False
    return _RELATION_CACHE[qualified]


#: Unicode combining-mark categories. Devanagari and Gujarati matras live here.
_MARK_CATEGORIES = frozenset({"Mn", "Mc", "Me"})
#: ZWNJ / ZWJ. Indic conjuncts are written with these and they are not
#: punctuation — deleting them rewrites the word.
_JOINERS = frozenset({"‌", "‍"})


def _keep_char(ch: str) -> bool:
    """
    Whether a character survives into the tsquery token.

    `str.isalnum()` ALONE IS WRONG HERE, and wrong in the exact direction this
    product cannot afford. Devanagari matras are `Mn`/`Mc` combining marks, not
    alphanumerics, so `"".join(c for c in "राकेश" if c.isalnum())` yields
    `रकश` — a word that is not the word, and does not prefix-match the stored
    one. Gujarati behaves identically. Bilingual search would have looked
    implemented and silently returned nothing for every Indic name.

    Marks and joiners are admitted; everything else that is not alphanumeric is
    dropped, which still excludes every `tsquery` operator (`& | ! ( ) : * < >`)
    and the quote. The result is additionally passed as a BIND PARAMETER to
    `to_tsquery(...)`, never concatenated into SQL, so this filter is a
    correctness guard rather than the injection defence.
    """
    if ch.isalnum() or ch in _JOINERS:
        return True
    return unicodedata.category(ch) in _MARK_CATEGORIES


def _tsquery(raw: str) -> str:
    """Compile a user string into a prefix tsquery: `rak nag` → `rak:* & nag:*`."""
    tokens = []
    for word in raw.split():
        cleaned = "".join(ch for ch in word if _keep_char(ch)).strip("".join(_JOINERS))
        # A token of nothing but combining marks is not a word — it cannot
        # prefix-match anything and `to_tsquery` would choke on the bare `:*`.
        if cleaned and any(ch.isalnum() for ch in cleaned):
            tokens.append(f"{cleaned}:*")
    return " & ".join(tokens)


def _fold(expr: str, unaccent: bool) -> str:
    return f"unaccent({expr})" if unaccent else expr


def _match_sql(columns: list[str], tsq_param: int, like_param: int, unaccent: bool) -> str:
    """
    The WHERE fragment for one entity.

    Both arms are needed and they answer different questions. The tsquery arm
    matches on word boundaries with prefixes, which is what a name search is.
    The ILIKE arm matches inside a token, which is what an invoice number or a
    GSTIN fragment is — `to_tsvector` would never match `4021` inside
    `INV-2026-4021`.
    """
    haystack = " || ' ' || ".join(f"COALESCE({c}, '')" for c in columns)
    folded = _fold(haystack, unaccent)
    ts = f"to_tsvector('simple', {folded}) @@ to_tsquery('simple', ${tsq_param})"
    like = f"{folded} ILIKE '%' || {_fold(f'${like_param}', unaccent)} || '%'"
    return f"({ts} OR {like})"


async def _module_allowed(request: Request, org_id: str, entity: str) -> bool:
    """
    Ask the real gate, do not re-derive the answer.

    `require_module(code)` returns the dependency callable; calling it directly
    runs the identical checks FastAPI would run — platform-role reach, the
    sensitive-module audit row, the per-user `org_member_modules` grant and the
    subscription state — and raises `HTTPException` when any of them refuses.
    A refusal here means "skip this group", never "fail the request".
    """
    code = _ENTITY_MODULE.get(entity)
    if code is None:
        return True
    try:
        await require_module(code)(request, org_id)
        return True
    except HTTPException:
        return False
    except Exception as exc:  # a broken gate must not open the door
        log.warning("search: module gate %s errored, skipping group: %s", code, exc)
        return False


async def _allowed_team_ids(pool, user_id: str, org_id: str) -> list[str]:
    """
    The caller's visible teams, narrowed to the active org.

    `get_visible_team_ids` lives in `server.py`, which imports this module, so
    the import is deferred to call time. It is the same helper every task read
    uses — reimplementing it here is how search and the task list end up
    disagreeing about who can see what.
    """
    from server import get_visible_team_ids  # deferred: server imports this router

    # The org goes IN, rather than only being applied to what comes out. The
    # narrowing below was written when the helper had no `org_id` parameter and
    # was the only thing standing between search and another org's teams; it
    # stays as the second half of a belt-and-braces pair, but the widening it
    # used to correct no longer happens.
    visible = await get_visible_team_ids(pool, user_id, org_id=org_id)
    if not visible:
        return []
    rows = await pool.fetch(
        "SELECT team_id FROM teams "
        "WHERE team_id = ANY($1::text[]) "
        "  AND deleted_at IS NULL "
        "  AND (org_id IS NULL OR org_id = $2::uuid)",
        list(visible), org_id,
    )
    return [r["team_id"] for r in rows]


# ── Entity queries ────────────────────────────────────────────────────────────
#
# Each returns (rows, total). `total` re-runs the SAME predicate — see the
# header on why it is not a count over a wider set.


async def _search_tasks(pool, uid, teams, tsq, like, unaccent, limit):
    # $1 teams · $2 uid · $3 tsquery · $4 raw term · $5 limit.
    # `base` is shared verbatim between the row query and the count so the two
    # cannot drift — a count computed over a different predicate than the rows
    # is exactly the leak this endpoint must not have.
    where = _match_sql(["t.title", "t.description"], 3, 4, unaccent)
    scope = "(t.team_id = ANY($1::text[]) OR (t.team_id IS NULL AND t.user_id = $2))"
    base = (
        "FROM tasks t LEFT JOIN teams tm ON tm.team_id = t.team_id "
        f"WHERE t.archived_at IS NULL AND {scope} AND {where}"
    )
    rows = await pool.fetch(
        "SELECT t.task_id, t.title, t.status, t.team_id, tm.name AS project_name "
        f"{base} ORDER BY t.updated_at DESC NULLS LAST LIMIT $5",
        teams, uid, tsq, like, limit,
    )
    total = await pool.fetchval(f"SELECT COUNT(*) {base}", teams, uid, tsq, like)
    out = [
        {
            "id": r["task_id"],
            "title": r["title"],
            "project": r["project_name"],
            "status": r["status"],
            # The board that holds it is a real route; `/tasks/:id` is not.
            "route": f"/projects/{r['team_id']}" if r["team_id"] else "/tasks",
        }
        for r in rows
    ]
    return out, int(total or 0)


async def _search_clients(pool, org_id, tsq, like, unaccent, limit):
    where = _match_sql(["cl.name", "cl.ref_no", "cl.gstin"], 2, 3, unaccent)
    base = (
        "FROM staging.graha_clients cl "
        f"WHERE cl.org_id = $1::uuid AND cl.is_active = TRUE AND {where}"
    )
    rows = await pool.fetch(
        f"SELECT cl.id, cl.name, cl.gstin {base} "
        "ORDER BY cl.updated_at DESC NULLS LAST LIMIT $4",
        org_id, tsq, like, limit,
    )
    total = await pool.fetchval(f"SELECT COUNT(*) {base}", org_id, tsq, like)
    out = [
        {"id": str(r["id"]), "name": r["name"], "gstin": r["gstin"], "route": "/graha"}
        for r in rows
    ]
    return out, int(total or 0)


async def _search_invoices(pool, org_id, tsq, like, unaccent, limit):
    where = _match_sql(["i.invoice_number", "cl.name"], 2, 3, unaccent)
    base = (
        "FROM staging.ganit_invoices i "
        "LEFT JOIN staging.graha_clients cl ON cl.id = i.client_id AND cl.org_id = i.org_id "
        f"WHERE i.org_id = $1::uuid AND i.is_active = TRUE AND {where}"
    )
    rows = await pool.fetch(
        f"SELECT i.id, i.invoice_number, i.payment_status, cl.name AS client_name {base} "
        "ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC LIMIT $4",
        org_id, tsq, like, limit,
    )
    total = await pool.fetchval(f"SELECT COUNT(*) {base}", org_id, tsq, like)
    out = [
        {
            "id": str(r["id"]),
            "number": r["invoice_number"],
            "client": r["client_name"],
            "status": r["payment_status"],
            "route": "/ganit",
        }
        for r in rows
    ]
    return out, int(total or 0)


async def _search_messages(pool, uid, org_id, tsq, like, unaccent, limit):
    """
    Channel access, restated exactly as `routers/messaging.py` states it.

    That router admits a reader when they are a member OR the channel is
    public (`if not mem and ch["type"] != "public": 403`). Search must match it
    in both directions: an inner join on membership alone would silently drop
    public-channel hits the user can plainly read, and dropping the check
    entirely would publish private channels into ⌘K. So membership is an
    EXISTS, OR-ed with `c.type = 'public'`, and the org predicate sits on the
    channel join where it cannot be forgotten.

    `users` is the public-schema table, deliberately. `messaging.py` joins
    `staging.users`, which does not exist on this database — see Appendix B of
    the audit. Copying that join would make this group fail on every query.
    """
    # $1 uid · $2 org_id · $3 tsquery · $4 raw term · $5 limit.
    where = _match_sql(["m.content"], 3, 4, unaccent)
    base = (
        "FROM staging.samvada_messages m "
        "JOIN staging.samvada_channels c ON c.id = m.channel_id AND c.org_id = $2::uuid "
        "LEFT JOIN users u ON u.user_id = m.sender_id "
        "WHERE m.is_deleted = FALSE "
        "  AND (c.type = 'public' OR EXISTS (SELECT 1 FROM staging.samvada_channel_members cm "
        "       WHERE cm.channel_id = c.id AND cm.user_id = $1)) "
        f"  AND {where}"
    )
    rows = await pool.fetch(
        "SELECT m.id, m.content, c.name AS channel_name, "
        "COALESCE(u.full_name, u.name, u.email) AS author_name "
        f"{base} ORDER BY m.created_at DESC LIMIT $5",
        uid, org_id, tsq, like, limit,
    )
    total = await pool.fetchval(f"SELECT COUNT(*) {base}", uid, org_id, tsq, like)
    out = [
        {
            "id": str(r["id"]),
            "snippet": _snippet(r["content"]),
            "author": r["author_name"],
            "channel": r["channel_name"],
            "route": "/sanvaad",
        }
        for r in rows
    ]
    return out, int(total or 0)


async def _search_files(pool, uid, teams, is_admin, tsq, like, unaccent, limit):
    """
    Attachments live in `tasks.attachments` JSONB, so this expands the array and
    filters it in SQL.

    The private-attachment rule is `server._filter_private_attachments`,
    restated here in SQL because the rows never become `TaskOut` objects: a
    private file is visible to its task's creator, to anyone named in
    `visible_to`, and to an org admin. Doing this in Python after the fact would
    mean the LIMIT had already been spent on rows the caller may not see, and
    the count would have included them.
    """
    where = _match_sql(["a.value ->> 'name'"], 4, 5, unaccent)
    privacy = (
        "(COALESCE((a.value ->> 'is_private')::boolean, FALSE) = FALSE "
        " OR t.created_by_user_id = $1 "
        " OR $3::boolean "
        " OR EXISTS (SELECT 1 FROM jsonb_array_elements_text("
        "      CASE WHEN jsonb_typeof(a.value -> 'visible_to') = 'array' "
        "           THEN a.value -> 'visible_to' ELSE '[]'::jsonb END) v "
        "    WHERE v = $1))"
    )
    base = (
        "FROM tasks t "
        "CROSS JOIN LATERAL jsonb_array_elements("
        "  CASE WHEN jsonb_typeof(t.attachments) = 'array' "
        "       THEN t.attachments ELSE '[]'::jsonb END) AS a(value) "
        "WHERE t.archived_at IS NULL "
        "  AND (t.team_id = ANY($2::text[]) OR (t.team_id IS NULL AND t.user_id = $1)) "
        f"  AND {privacy} AND {where}"
    )
    rows = await pool.fetch(
        "SELECT t.task_id, t.team_id, t.title AS task_title, "
        "a.value ->> 'name' AS file_name, a.value ->> 'key' AS file_key "
        f"{base} ORDER BY t.updated_at DESC NULLS LAST LIMIT $6",
        uid, teams, is_admin, tsq, like, limit,
    )
    total = await pool.fetchval(f"SELECT COUNT(*) {base}", uid, teams, is_admin, tsq, like)
    out = [
        {
            # Attachments have no id of their own. The task plus the R2 key is
            # the only stable identity, and the palette uses `id` purely as a
            # React key, so a composite is correct rather than a fabricated uuid.
            "id": f"{r['task_id']}:{r['file_key'] or r['file_name']}",
            "name": r["file_name"],
            "task": r["task_title"],
            "route": f"/projects/{r['team_id']}" if r["team_id"] else "/tasks",
        }
        for r in rows
    ]
    return out, int(total or 0)


def _snippet(text: Optional[str], width: int = 140) -> str:
    body = " ".join((text or "").split())
    return body if len(body) <= width else body[: width - 1] + "…"


# ── Endpoint ──────────────────────────────────────────────────────────────────


@router.get("/search")
async def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    scope: str = Query("all"),
    limit: int = Query(5, ge=1, le=_MAX_LIMIT),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
) -> dict[str, Any]:
    """
    Cross-module record search for the command palette.

    Returns one array per entity plus `counts`. Groups the caller may not reach
    are omitted and named in `unavailable`; that distinction is what lets the
    palette say "not available in this workspace" instead of "no results",
    which would be a claim about the data rather than about access.
    """
    if scope != "all" and scope not in _ENTITIES:
        raise HTTPException(400, f"scope must be 'all' or one of: {', '.join(_ENTITIES)}")

    wanted = _ENTITIES if scope == "all" else (scope,)

    term = q.strip()
    tsq = _tsquery(term)
    # Two characters is the palette's own floor; below it every row matches and
    # the round trip buys nothing. An all-punctuation query compiles to an empty
    # tsquery, which `to_tsquery` rejects outright — answer it as empty instead.
    if len(term) < _MIN_QUERY or not tsq:
        return {
            "q": term,
            "scope": scope,
            "counts": {k: 0 for k in wanted},
            "unavailable": [],
            **{k: [] for k in wanted},
        }

    pool = await get_pool()
    unaccent = await _has_unaccent(pool)
    uid = user["user_id"]

    results: dict[str, Any] = {}
    counts: dict[str, int] = {}
    unavailable: list[str] = []

    teams: Optional[list[str]] = None
    is_admin: Optional[bool] = None

    for entity in wanted:
        if not await _module_allowed(request, org_id, entity):
            unavailable.append(entity)
            continue
        try:
            if entity in ("tasks", "files"):
                if teams is None:
                    teams = await _allowed_team_ids(pool, uid, org_id)
                if entity == "tasks":
                    rows, total = await _search_tasks(
                        pool, uid, teams, tsq, term, unaccent, limit
                    )
                else:
                    if is_admin is None:
                        is_admin = await is_org_admin(uid, org_id)
                    rows, total = await _search_files(
                        pool, uid, teams, is_admin, tsq, term, unaccent, limit
                    )
            elif entity == "clients":
                rows, total = await _search_clients(pool, org_id, tsq, term, unaccent, limit)
            elif entity == "invoices":
                rows, total = await _search_invoices(pool, org_id, tsq, term, unaccent, limit)
            elif entity == "messages":
                if not await _relation_exists(pool, "staging.samvada_messages"):
                    unavailable.append(entity)
                    continue
                rows, total = await _search_messages(
                    pool, uid, org_id, tsq, term, unaccent, limit
                )
            else:  # pragma: no cover — _ENTITIES is closed
                continue
        except Exception as exc:
            # One broken source must not blank a palette the user is typing
            # into. The group is reported unavailable and the rest still answer.
            log.warning("search: %s group failed for org %s: %s", entity, org_id, exc)
            unavailable.append(entity)
            continue

        results[entity] = rows
        counts[entity] = total

    return {
        "q": term,
        "scope": scope,
        "counts": counts,
        "unavailable": unavailable,
        **results,
    }
