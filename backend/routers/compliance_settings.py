"""
compliance_settings.py — `GET /api/v1/org/compliance`, `GET/PATCH /{module}`,
and the per-client / per-employee override surface added on top of it:

    GET    /targets/{scope_type}          who an override can be about
    GET    /scope/{scope_type}/{scope_id} the firm default, the override, and
                                          which of the two is in force
    PATCH  /{module}/override             write one override
    DELETE /{module}/override             remove one override

The settings surface for `staging.module_compliance_settings` (migration
210, workstream H / proposal 80). One generic endpoint for every module in
the registry (`services/compliance_settings.py::RULES`) rather than one
router per module — the table, the resolver and the validation are already
generic; a bespoke endpoint per module would just be repeating the same
four lines with a different string literal.

── FOUR THINGS THIS ROUTER DOES THAT THE RESOLVER DOES NOT ─────────────────

1. `GET ""` — the whole screen in one call. `pages/org/TabCompliance.jsx`
   renders every module at once, so fetching per module would be N requests
   for one panel. `svc.resolve_all` does it in a single query.

2. `set_by` NEVER LEAVES AS AN ID. The table stores `public.users.user_id`
   (TEXT, `user_f1a0a472b98f`) and the product's rule is that a user, member
   or org id is never rendered — `frontend/scripts/check-rendered-ids.mjs` is
   the ratchet. `_named` swaps it for the display name from
   `services/audit_actors`, which is the one ladder in this codebase that
   resolves a person and stops before their email address. The raw id is
   dropped from the payload entirely rather than shipped alongside the name:
   a field that is present is a field a screen can render.

   `has_setter` travels beside it for the same reason `actor_select` emits
   one — "nobody has touched this rule" and "somebody set it and their
   account is gone" are different facts, and one NULL name cannot say which.

3. THE AUDIT ROW SAYS WHAT IT CHANGED FROM. `emit` was already called; it
   recorded only the new state, so the trail read "hsn_required is now
   not_applicable" with no way to tell a first decision from a reversal.
   The previous state is resolved before the write and travels in `detail`.
   For a compliance setting that distinction is most of the value of having
   an audit trail at all: proposal 80's rule 1 is that "not applicable" must
   be legible six months later as a decision rather than as a warning that
   somebody made go away.

4. `scope_id` IS USER INPUT AND IS PROVED TO BE THIS ORG'S BEFORE ANY WRITE.
   Migration 253 lets a rule be overridden for one client or one employee, so
   two of the routes above take a uuid out of a query string or a request
   body. A uuid in a payload is a PARAMETER, not a secret: it is guessable,
   it is quotable from another tenant's URL, and both `graha_clients.id` and
   `manav_employees.id` are unique table-wide — so a statement that filters on
   the id ALONE reads and writes across organisations, silently, with no error
   and no log line. That exact hole has been closed three times in this
   codebase (PHASE-7 §7.1a), and `services/compliance_settings.py::
   resolve_effective` carries the same warning over its own WHERE clause.

   So: `_scope_row` resolves every incoming `scope_id` against a statement
   that binds `org_id` beside it, and returns the subject's NAME. Nothing
   further happens until it has. The name is what the screen draws — "not
   applicable for Acme Traders" — which means the row has to be fetched
   anyway, and the check costs a query the payload already needed.

   `scope_type` is user input too, and it chooses a TABLE. It is never
   interpolated into SQL: `_SCOPE_ROW` and `_SCOPE_LIST` hold finished
   statements keyed by scope, so there is no format string for a caller to
   reach into and a fourth scope means writing a fourth statement.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.role_tiers import ORG_SETTINGS_ROLES
from pydantic import BaseModel
from services import compliance_settings as svc
from services.audit import emit as audit
from services.audit_actors import display_name

router = APIRouter(prefix="/api/v1/org/compliance", tags=["compliance-settings"])


async def _setter_names(pool, rule_maps: list[dict]) -> dict[str, str]:
    """`{user_id: display name}` for every `set_by` across the given rule maps.

    One query for the whole screen, not one per rule. LEFT-join semantics by
    hand: an id with no `public.users` row simply does not appear in the dict,
    and `_named` renders that as "no longer with the firm" rather than as
    nobody having set the rule.
    """
    ids = sorted({
        rule["set_by"]
        for rules in rule_maps for rule in rules.values()
        if rule.get("set_by")
    })
    if not ids:
        return {}
    rows = await pool.fetch(
        f"SELECT u.user_id, {display_name('u')} AS setter_name "
        "FROM public.users u WHERE u.user_id = ANY($1::text[])",
        ids,
    )
    return {r["user_id"]: r["setter_name"] for r in rows}


def _named(rules: dict, names: dict[str, str]) -> dict:
    """Swap every `set_by` id for a name. The id is REMOVED, not hidden."""
    out = {}
    for key, rule in rules.items():
        setter = rule.pop("set_by", None)
        out[key] = {
            **rule,
            "has_setter": bool(setter),
            # None when nobody set it; the label when the account is gone.
            "set_by_name": names.get(setter) if setter else None,
        }
    return out


# ══════════════════════════════════════════════════════════════════════════
#  Scopes — who an override is about
# ══════════════════════════════════════════════════════════════════════════

#: Prove one `scope_id` belongs to the caller's organisation, and get the name
#: the screen will draw. Two FINISHED statements keyed by scope rather than one
#: template with the table name substituted in: `scope_type` arrives from the
#: caller, and an allowlist that hands back a completed statement cannot be
#: half-applied the way "look the name up, then f-string it" can.
#:
#: ⚠ `org_id` IS IN EVERY PREDICATE. See item 4 of the module docstring — a
#: client id is unique table-wide, so `WHERE id=$1` alone is a cross-tenant
#: read for anybody who can quote a uuid from another firm's URL.
#:
#: ⚠ AND `is_active` IS DELIBERATELY NOT HERE, though it IS in `_SCOPE_LIST`
#: below. The two questions are different: the picker offers live clients, but
#: an override already written against a client who has since been archived
#: must still be readable and, above all, CLEARABLE. Filtering here would
#: strand exactly the rows somebody most needs to tidy up, and it would do it
#: as a 404 that reads like the id was wrong.
_SCOPE_ROW: dict[str, str] = {
    "client": (
        "SELECT name FROM public.graha_clients "
        "WHERE id=$1::uuid AND org_id=$2::uuid"
    ),
    "employee": (
        "SELECT name FROM public.manav_employees "
        "WHERE id=$1::uuid AND org_id=$2::uuid"
    ),
}

#: The picker's list. `$2::text` and `$3::int` are cast because PgBouncer turns
#: an untyped parameter expression into an instant 500 (CLAUDE.md, SQL rules) —
#: `$2 IS NULL OR name ILIKE '%' || $2 || '%'` is precisely such an expression.
_SCOPE_LIST: dict[str, str] = {
    "client": (
        "SELECT id, COALESCE(NULLIF(btrim(name), ''), 'Unnamed company') AS name "
        "FROM public.graha_clients "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
        "  AND ($2::text IS NULL OR name ILIKE '%' || $2::text || '%') "
        # ORDER BY 2, not `name`: the ordinal is unambiguously the COALESCEd
        # label, and a row with no name must sort where the screen will show it
        # rather than where an empty string would put it.
        "ORDER BY 2 LIMIT $3::int"
    ),
    "employee": (
        "SELECT id, COALESCE(NULLIF(btrim(name), ''), 'Unnamed employee') AS name "
        "FROM public.manav_employees "
        "WHERE org_id=$1::uuid AND is_active=TRUE "
        "  AND ($2::text IS NULL OR name ILIKE '%' || $2::text || '%') "
        "ORDER BY 2 LIMIT $3::int"
    ),
}

#: What to call a subject whose own name column is blank. A nameless row is
#: still a real client with a real override; rendering "" would draw a picker
#: entry that cannot be clicked on and a sentence with a hole in it.
_SCOPE_UNNAMED: dict[str, str] = {
    "client": "Unnamed company",
    "employee": "Unnamed employee",
}

#: The word the error messages use. "That is not a scope" tells a person
#: nothing; "that client is not in this organisation" tells them where to look.
_SCOPE_NOUN: dict[str, str] = {"client": "client", "employee": "employee"}

#: One page of picker options. 200 to match `GET /v1/graha/clients`, which is
#: the list this one shadows — and, like it, this product already has orgs past
#: it (292 live contacts against a 200-row window, `ui/ServerPicker.jsx`). So
#: the page carries `truncated` and the endpoint takes `q`: a picker that
#: silently drops the other 92 is how a user creates a second copy of a company
#: they could not find.
_TARGET_PAGE = 200


def _scope_uuid(scope_id: str | None) -> str:
    """A uuid, or a 400 — never an unparseable string straight into `$n::uuid`.

    asyncpg answers `invalid input syntax for type uuid` for anything else, and
    that surfaces as a 500: the caller is told the server broke when what
    actually happened is that they sent a malformed parameter. Same family as
    the untyped-parameter trap above, one layer up from the database.
    """
    try:
        return str(UUID(str(scope_id)))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(400, "That is not a valid client or employee reference.")


def _override_scope(scope_type: str) -> str:
    """The scope of an OVERRIDE — never `org`, never anything unknown.

    `org` is refused here rather than left to `svc.set_rule` / `svc.clear_rule`
    so the message can say what to do instead. The firm-wide default is a real
    thing with its own live route; the failure mode this prevents is somebody
    editing what looks like one client's exception and silently rewriting the
    default for every client at once.
    """
    if scope_type == "org":
        raise HTTPException(
            400,
            "The firm-wide default is not an override. Change it through "
            "PATCH /api/v1/org/compliance/{module}; it cannot be cleared, only "
            "set to another state.",
        )
    if scope_type not in _SCOPE_ROW:
        raise HTTPException(
            400,
            f"'{scope_type}' is not something a compliance setting can be "
            f"overridden for. Valid: {', '.join(sorted(_SCOPE_ROW))}.",
        )
    return scope_type


async def _scope_name(pool, org_id: str, scope_type: str, scope_id: str) -> str:
    """The subject's display name, having PROVED it is this organisation's.

    404 rather than 403 on a miss, and one sentence for both "no such id" and
    "that id belongs to another firm": telling the two apart out loud would
    confirm the existence of another tenant's record to anyone who can guess a
    uuid, which is the same leak in a politer wrapper.
    """
    row = await pool.fetchrow(_SCOPE_ROW[scope_type], scope_id, org_id)
    if row is None:
        raise HTTPException(
            404, f"That {_SCOPE_NOUN[scope_type]} is not in this organisation.")
    return (row["name"] or "").strip() or _SCOPE_UNNAMED[scope_type]


def _setter_maps(rules: dict) -> list[dict]:
    """The THREE levels a `set_by` hides at in a `resolve_effective` payload.

    `_setter_names` walks `rules.values()` and reads one `set_by` per entry. An
    effective rule carries three — its own, its `default`'s and its
    `override`'s — and the nested two are invisible to that walk.

    ⚠ THE ORIGINAL VERSION OF THIS DOCSTRING HAD THE BUG BACKWARDS, and it is
    worth correcting rather than quietly deleting. It claimed the OVERRIDE's
    setter was lost and that the row then read "nobody has set this". Neither
    half was true. `resolve_effective` spreads the override into the top level,
    so the plain walk DOES find the override's setter; what it misses is the
    FIRM DEFAULT's. And `Provenance` renders `has_setter: true` with a null name
    as "Set by someone whose account has since been removed" — so the symptom
    was the screen telling an administrator that a current colleague's account
    had been deleted, which is worse than the absence it claimed.

    The function is necessary either way. The reason it is necessary is this
    one.
    """
    return [
        rules,
        {k: v["default"] for k, v in rules.items() if v.get("default")},
        {k: v["override"] for k, v in rules.items() if v.get("override")},
    ]


def _named_effective(rules: dict, names: dict[str, str]) -> dict:
    """`_named`, applied at all three levels, with the scope id stripped.

    Every dict is copied before `_named` pops `set_by` out of it, because
    `resolve_effective` SHARES the override dict between the top level and the
    `override` key — popping in place would name one of them and leave the
    other with a raw id in it.
    """
    out = {}
    for key, rule in rules.items():
        default = rule.get("default") or {}
        override = rule.get("override")
        top = _named({key: dict(rule)}, names)[key]
        # The spread carried the un-named nested copies along; they are shaped
        # separately below, so drop the originals rather than ship two versions
        # of the same rule, one of which still holds an id.
        top.pop("default", None)
        top.pop("override", None)
        # ⚠ THE SCOPE ID DOES NOT LEAVE THE PROCESS. `resolve_effective`
        # returns it so a caller can tell which override it is holding; the
        # screen already knows, because it asked for this one. Rule 2 above: a
        # field that is present is a field a screen can render.
        top.pop("scope_id", None)
        out[key] = {
            **top,
            "default": _named({key: dict(default)}, names)[key] if default else None,
            "override": _named({key: dict(override)}, names)[key] if override else None,
        }
    return out


@router.get("")
async def get_all_settings(
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Every module that has compliance settings, resolved for this org.

    `active` is whether the org subscribes to the module. It ANNOTATES and
    never filters: a firm that recorded "composition scheme applies to us"
    and later switched Ganit off must still be able to see and correct that
    record — hiding it would leave a stored position nobody can reach, which
    is worse than an extra heading.
    """
    pool = await get_pool()
    modules = await svc.resolve_all(pool, org_id)
    names = await _setter_names(pool, [m["rules"] for m in modules])
    active = {
        r["module_code"] for r in await pool.fetch(
            "SELECT module_code FROM public.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
    }
    return {
        "modules": [
            {
                "module": m["module"],
                "active": m["module"] in active,
                "rules": _named(m["rules"], names),
            }
            for m in modules
        ],
        # Stated by the server so the screen does not hardcode the product's
        # own default in a second place and drift from it.
        "default_state": svc.DEFAULT_STATE,
    }


@router.get("/{module}")
async def get_module_settings(
    module: str,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    if not svc.rules_for(module):
        raise HTTPException(404, f"'{module}' has no compliance settings.")
    pool = await get_pool()
    rules = await svc.resolve(pool, org_id, module)
    names = await _setter_names(pool, [rules])
    return {"module": module, "rules": _named(rules, names)}


class RulePatch(BaseModel):
    rule_key: str
    state: str
    reason: str | None = None


@router.patch("/{module}")
async def patch_module_setting(
    module: str,
    body: RulePatch,
    request: Request,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()
    # Read BEFORE the write, so the audit row can say what it changed from.
    # A miss resolves to the default, which is the honest answer: an absent
    # row IS `applicable` (services/compliance_settings.py).
    previous = (await svc.resolve_states(pool, org_id, module)).get(
        body.rule_key, svc.DEFAULT_STATE)

    try:
        row = await svc.set_rule(
            pool, org_id, module, body.rule_key, body.state,
            set_by=user["user_id"], reason=body.reason,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    audit(
        "compliance.setting_updated", request, org_id=org_id, user_id=user["user_id"],
        resource_type="module_compliance_settings",
        resource_id=f"{module}.{body.rule_key}",
        detail={
            "module": module, "rule_key": body.rule_key,
            "previous_state": previous, "state": body.state,
            # Recorded on the event as well as on the row: the row is
            # overwritten by the next change, the event is not.
            "reason": body.reason,
        },
        severity="warn",
    )
    names = await _setter_names(pool, [{body.rule_key: dict(row)}])
    return {
        "status": "updated",
        "module": module,
        "previous_state": previous,
        **_named({body.rule_key: dict(row)}, names)[body.rule_key],
        "rule_key": row["rule_key"],
    }


# ══════════════════════════════════════════════════════════════════════════
#  Overrides — one client's or one employee's exception
#
#  The owner's ask, verbatim: "by default settings default will apply on all
#  but if org, client asked to or remove gst, or employee negotiation on leave
#  and commission then it override default setting."
#
#  The routes below never touch the firm's default. That is not tidiness: the
#  two are rows in ONE table, and the whole reason `resolve` and `resolve_all`
#  carry `scope_type='org'` in their predicates is that an override read as a
#  default shows the wrong answer to everybody with nothing raised anywhere.
#  Keeping the write paths apart is the same guard from the other end.
# ══════════════════════════════════════════════════════════════════════════


@router.get("/targets/{scope_type}")
async def list_scope_targets(
    scope_type: str,
    q: str | None = Query(None, max_length=120),
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Who this firm can record an exception for — id and NAME, nothing else.

    ── WHY THIS AND NOT `GET /v1/graha/clients` ────────────────────────────
    Two reasons, and neither is that the CRM list is wrong.

    The first is entitlement. This panel is gated on ORG_SETTINGS_ROLES, and
    the CRM and HR lists are gated on their own modules — an org_admin
    configuring compliance for a firm that has not switched Manav on would get
    a 403 from the employee picker and no way to record the employee exception
    the owner asked for. The gate on a picker has to be the gate on the screen
    the picker is part of.

    The second is what those lists RETURN. `manav_employees` rows carry email,
    phone, salary-adjacent fields and a home address; a settings screen that
    needs a name and an id has no business pulling any of it into a browser.
    This ships two columns.

    `truncated` is honest rather than convenient: with `q` unset this is the
    first 200 by name, and a picker that quietly drops the 201st is how a user
    concludes a client does not exist.
    """
    _override_scope(scope_type)
    pool = await get_pool()
    rows = await pool.fetch(
        _SCOPE_LIST[scope_type], org_id, (q or None), _TARGET_PAGE + 1)
    return {
        "scope_type": scope_type,
        # `id` is a KEY here — it is what the next request binds, exactly as
        # `routers/audit.py` ships `user_id` because its own filter needs it.
        # `check-rendered-ids.mjs` is what keeps it out of a rendered position.
        "targets": [{"id": str(r["id"]), "name": r["name"]}
                    for r in rows[:_TARGET_PAGE]],
        "truncated": len(rows) > _TARGET_PAGE,
        "page_size": _TARGET_PAGE,
    }


@router.get("/scope/{scope_type}/{scope_id}")
async def get_scoped_settings(
    scope_type: str,
    scope_id: str,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Every module's rules for ONE client or employee: default, override, answer.

    Shaped deliberately like `GET ""` — same `modules` list, same `active`
    annotation, same `default_state` — so the screen renders one panel for the
    firm and for a client rather than growing a second layout that drifts.
    What differs is inside each rule: `default`, `override` and `source`.

    ⚠ `source` IS THE SERVER'S ANSWER AND MUST NOT BE RE-DERIVED. An override
    that happens to set the SAME value as the firm default is still an
    override — somebody decided it deliberately, and the next person to change
    the firm default must not silently change this client with it. Comparing
    `state` to `default.state` cannot see that; `source` can, and it is the
    only reason this endpoint returns three things instead of one.

    ── THE QUERY COUNT, WRITTEN DOWN RATHER THAN LEFT TO BE FOUND ──────────
    Item 1 of this module's header is that the screen gets its whole panel in
    one call, and `svc.resolve_all` does it in one query. There is no
    `resolve_all_effective`, so this loops `resolve_effective` per module:
    today that is two modules and four queries, on a settings tab, behind an
    admin-only gate. It is still ONE round trip from the browser, which is the
    part item 1 is actually about. If `MODULE_ORDER` grows past a handful the
    fix belongs in the service beside `resolve_all` — not a second reader over
    the same table written here, which is the shape this file exists to avoid.
    """
    _override_scope(scope_type)
    pool = await get_pool()
    sid = _scope_uuid(scope_id)
    # Before anything is read per module: prove the subject is this firm's.
    scope_name = await _scope_name(pool, org_id, scope_type, sid)

    resolved = [
        (module, await svc.resolve_effective(pool, org_id, module, scope_type, sid))
        for module in svc.modules()
    ]
    names = await _setter_names(
        pool, [m for _, rules in resolved for m in _setter_maps(rules)])
    active = {
        r["module_code"] for r in await pool.fetch(
            "SELECT module_code FROM public.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
    }
    return {
        "scope_type": scope_type,
        # The NAME, and no id. The caller sent the id; it does not need it back,
        # and every sentence on the screen is built from this.
        "scope_name": scope_name,
        "default_state": svc.DEFAULT_STATE,
        "modules": [
            {
                "module": module,
                "active": module in active,
                "rules": _named_effective(rules, names),
            }
            for module, rules in resolved
        ],
    }


async def _effective_rule(pool, org_id, module, rule_key, scope_type, scope_id):
    """One rule, re-resolved after a write, in the shape the screen renders.

    Re-read rather than reconstructed from the row that was just written. The
    screen needs `default`, `override` and `source` together, and assembling
    those in the client from an INSERT's RETURNING clause would mean the
    browser deciding what `source` is — the one derivation this whole feature
    exists to take away from it. One extra query buys that.
    """
    rules = await svc.resolve_effective(pool, org_id, module, scope_type, scope_id)
    names = await _setter_names(pool, _setter_maps(rules))
    return _named_effective(rules, names).get(rule_key)


class OverridePatch(BaseModel):
    rule_key: str
    state: str
    scope_type: str
    scope_id: str
    reason: str | None = None


@router.patch("/{module}/override")
async def patch_scoped_setting(
    module: str,
    body: OverridePatch,
    request: Request,
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Record one client's or one employee's exception to a firm default.

    Writes `scope_type` / `scope_id` and nothing else differently: the state
    vocabulary, the refusal to `enforce` a rule nothing reads, and the two
    partial unique indexes are all `svc.set_rule`'s, unchanged. This route's
    own job is the org check on `scope_id` and the audit row.
    """
    if not svc.rules_for(module):
        raise HTTPException(404, f"'{module}' has no compliance settings.")
    scope_type = _override_scope(body.scope_type)
    pool = await get_pool()
    sid = _scope_uuid(body.scope_id)
    scope_name = await _scope_name(pool, org_id, scope_type, sid)

    # Read BEFORE the write — same reason as the firm-level PATCH, plus one
    # more. `previous_source` is what tells a first exception ("this client was
    # following the firm and now is not") from a revision of one, and no amount
    # of reading `previous_state` afterwards recovers it.
    before = (await svc.resolve_effective(
        pool, org_id, module, scope_type, sid)).get(body.rule_key) or {}
    previous_state = before.get("state", svc.DEFAULT_STATE)
    previous_source = before.get("source", "default")

    try:
        await svc.set_rule(
            pool, org_id, module, body.rule_key, body.state,
            set_by=user["user_id"], reason=body.reason,
            scope_type=scope_type, scope_id=sid,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    audit(
        # ⚠ THE SAME ACTION AS THE FIRM-LEVEL WRITE, ON PURPOSE.
        # `/v1/audit/events` filters on ONE action string, and the decision
        # history on this screen is a single list. A separate action would make
        # every override invisible in it — and an override IS a compliance
        # decision by proposal 80's rule 1, so it belongs in the same sequence.
        # `detail.scope_type` is what tells them apart.
        "compliance.setting_updated", request, org_id=org_id, user_id=user["user_id"],
        resource_type="module_compliance_settings",
        # The id is in the RESOURCE key, which is what an auditor queries by and
        # what nothing renders — never in `detail`, which this screen draws from.
        resource_id=f"{module}.{body.rule_key}@{scope_type}:{sid}",
        detail={
            "module": module, "rule_key": body.rule_key,
            "previous_state": previous_state, "state": body.state,
            "scope_type": scope_type,
            # The NAME, so the history line reads "for Acme Traders" six months
            # from now even if the client has since been renamed or removed. A
            # trail that has to join back to a live table to be legible stops
            # being legible exactly when it matters.
            "scope_name": scope_name,
            "previous_source": previous_source,
            "reason": body.reason,
        },
        severity="warn",
    )
    return {
        "status": "updated",
        "module": module,
        "scope_type": scope_type,
        "scope_name": scope_name,
        "rule_key": body.rule_key,
        "previous_state": previous_state,
        "previous_source": previous_source,
        # Nested under `rule` rather than spread. The effective shape already
        # has `default` and `override` inside it; spreading would sit those
        # beside `status` and leave the screen guessing which keys are the rule.
        "rule": await _effective_rule(
            pool, org_id, module, body.rule_key, scope_type, sid),
    }


@router.delete("/{module}/override")
async def clear_scoped_setting(
    module: str,
    request: Request,
    rule_key: str = Query(..., max_length=120),
    scope_type: str = Query(...),
    scope_id: str = Query(...),
    reason: str | None = Query(None, max_length=500),
    user=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Remove one override so the firm's default applies to this subject again.

    ⚠ ONLY EVER AN OVERRIDE. `_override_scope` refuses `org` before anything
    is read, and `svc.clear_rule` refuses it again for callers that are not
    this route. A firm default is CHANGED by writing another state; there is
    no "unset" for it, because every rule always resolves to something.

    `reason` is a QUERY PARAMETER and it is recorded on the audit event only —
    the row it would otherwise annotate is the one being deleted. Reversing a
    decision is a decision (proposal 80, rule 1), and this is the only place
    left to write down why.
    """
    if not svc.rules_for(module):
        raise HTTPException(404, f"'{module}' has no compliance settings.")
    scope_type = _override_scope(scope_type)
    pool = await get_pool()
    sid = _scope_uuid(scope_id)
    scope_name = await _scope_name(pool, org_id, scope_type, sid)

    before = (await svc.resolve_effective(
        pool, org_id, module, scope_type, sid)).get(rule_key) or {}
    previous_state = before.get("state", svc.DEFAULT_STATE)

    try:
        removed = await svc.clear_rule(
            pool, org_id, module, rule_key, scope_type, sid)
    except ValueError as e:
        raise HTTPException(400, str(e))

    rule = await _effective_rule(
        pool, org_id, module, rule_key, scope_type, sid)

    if removed:
        audit(
            "compliance.setting_updated", request, org_id=org_id,
            user_id=user["user_id"],
            resource_type="module_compliance_settings",
            resource_id=f"{module}.{rule_key}@{scope_type}:{sid}",
            detail={
                "module": module, "rule_key": rule_key,
                "previous_state": previous_state,
                # What it fell back TO, not a null. The history line reads as a
                # change between two states like every other row in it.
                "state": (rule or {}).get("state", svc.DEFAULT_STATE),
                "scope_type": scope_type,
                "scope_name": scope_name,
                "previous_source": "override",
                "cleared": True,
                "reason": reason,
            },
            severity="warn",
        )

    return {
        # Two outcomes, not one. `clear_rule` reports whether a row was
        # actually there, and "reverted to the firm default" is a different
        # fact from "there was nothing to revert" — the same distinction
        # `has_setter` makes, and the reason no audit row is written above for
        # the second: an event saying a decision was reversed, when no decision
        # existed, is a false entry in the one record that may not carry any.
        "status": "cleared" if removed else "nothing_to_clear",
        "module": module,
        "scope_type": scope_type,
        "scope_name": scope_name,
        "rule_key": rule_key,
        "previous_state": previous_state,
        "rule": rule,
    }
