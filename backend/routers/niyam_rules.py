"""The rule builder's API. Authoring, preview, and honest history.

THE PREVIEW IS THE POINT
------------------------
`POST /rules/{id}/preview` replays a rule's conditions against the LAST N REAL
EVENTS of its type and reports, per event, what would have happened. It writes
nothing: no run rows, no run steps, no notifications, no `processed_at`.

That is what "the owner arms nothing but can see exactly what would happen"
means, and it is only trustworthy because the preview and the engine call the
SAME evaluator. A preview that re-implemented the matching would be a second
opinion, and the whole disease being cured here is two components disagreeing
about what a rule does.

WHY EVERY LIST IS ORG-SCOPED IN SQL, NOT IN PYTHON
--------------------------------------------------
`org_id = $1::uuid` is in every WHERE clause rather than filtered after the
fetch. A rule names people to notify; a leak across tenants here is a leak of
who works where.
"""
from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field as PField

from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.role_tiers import ORG_SETTINGS_ROLES
from services.niyam.conditions import evaluate_all
from services.niyam.flags import describe, rule_effective_mode
from services.niyam.registry import (OPERATORS, REGISTRY, catalog_event_types,
                                     fields_for, meta_for)
from services.niyam.templates import TEMPLATES, by_id, decorated
from services.niyam.validate import RuleInvalid, validate_event_type, validate_steps

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/niyam", tags=["niyam-rules"])

#: How many recent events a preview replays. Enough to be convincing, small
#: enough that the query is bounded on a table that grows for ever.
PREVIEW_EVENTS = 50


class StepIn(BaseModel):
    kind: str
    config: dict = PField(default_factory=dict)


class RuleIn(BaseModel):
    name: str
    event_type: str
    steps: list[StepIn] = PField(default_factory=list)


class RulePatch(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    is_armed: bool | None = None
    steps: list[StepIn] | None = None


def _invalid(exc: RuleInvalid):
    # 422 with the step number, so the builder can point at the card rather than
    # showing a banner the author has to map back onto their pipeline.
    return HTTPException(422, detail=exc.as_dict())


# ── what the builder may offer ───────────────────────────────────────────────

@router.get("/catalog")
async def catalog(_=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    """Every event type, its fields, and the operators each field allows.

    The builder renders ONLY from this. That is the structural half of "a broken
    rule is unwritable": the field list a person picks from and the field list
    the engine can evaluate are the same list, served from one registry, so they
    cannot drift the way the old builder drifted from its engine.
    """
    from services.niyam.actions import ACTIONS
    return {
        "events": [
            {
                "event_type": et,
                **meta_for(et),
                "fields": [
                    {"key": f.key, "label": f.label, "kind": f.kind,
                     "options": list(f.options),
                     "operators": list(OPERATORS.get(f.kind, ()))}
                    for f in fields_for(et)
                ],
            }
            # NOT `sorted(REGISTRY)`: an event the product cannot emit must not
            # be offerable, or the builder sells a rule that can never fire.
            for et in catalog_event_types()
        ],
        "actions": sorted(ACTIONS),
        "flags": describe(),
    }


@router.get("/templates")
async def templates(_=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    """Starter rules. Every one validates through the same path a hand-written
    rule does — see services/niyam/templates.py."""
    return {"templates": decorated()}


# ── rules ────────────────────────────────────────────────────────────────────

@router.get("/rules")
async def list_rules(org_id: str = Depends(get_org_id),
                     _=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT r.rule_id, r.name, r.event_type, r.enabled, r.is_armed,
               r.created_at, r.updated_at,
               (SELECT count(*) FROM staging.niyam_runs n
                 WHERE n.rule_id = r.rule_id)                       AS runs_total,
               (SELECT count(*) FROM staging.niyam_runs n
                 WHERE n.rule_id = r.rule_id
                   AND n.started_at > NOW() - INTERVAL '7 days')    AS runs_7d,
               (SELECT max(started_at) FROM staging.niyam_runs n
                 WHERE n.rule_id = r.rule_id)                       AS last_run_at
          FROM staging.niyam_rules r
         WHERE r.org_id = $1::uuid
         ORDER BY r.created_at DESC
        """,
        org_id)
    out = []
    for r in rows:
        d = dict(r)
        # The rule's OWN switches say what the author intended; `effective_mode`
        # says what would actually happen right now, because the master switch
        # can veto both. A UI that shows only `is_armed` tells somebody their
        # rule is live when the engine is not.
        d["effective_mode"] = rule_effective_mode(r["is_armed"])
        d.update(meta_for(r["event_type"]))
        for k in ("created_at", "updated_at", "last_run_at"):
            if d.get(k) is not None:
                d[k] = d[k].isoformat()
        out.append(d)
    return {"rules": out, "flags": describe()}


async def _load(pool, org_id: str, rule_id: str):
    rule = await pool.fetchrow(
        "SELECT * FROM staging.niyam_rules WHERE rule_id=$1::text AND org_id=$2::uuid",
        rule_id, org_id)
    if rule is None:
        raise HTTPException(404, "No such rule")
    steps = await pool.fetch(
        "SELECT step_no, kind, config FROM staging.niyam_rule_steps "
        "WHERE rule_id=$1::text ORDER BY step_no", rule_id)
    return rule, steps


def _steps_out(steps):
    out = []
    for s in steps:
        cfg = s["config"]
        out.append({"step_no": s["step_no"], "kind": s["kind"],
                    "config": json.loads(cfg) if isinstance(cfg, str) else cfg})
    return out


@router.get("/rules/{rule_id}")
async def get_rule(rule_id: str, org_id: str = Depends(get_org_id),
                   _=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    pool = await get_pool()
    rule, steps = await _load(pool, org_id, rule_id)
    d = dict(rule)
    d["effective_mode"] = rule_effective_mode(rule["is_armed"])
    d.update(meta_for(rule["event_type"]))
    for k in ("created_at", "updated_at"):
        d[k] = d[k].isoformat()
    d["org_id"] = str(d["org_id"])
    return {"rule": d, "steps": _steps_out(steps)}


async def _write_steps(conn, rule_id: str, steps: list) -> None:
    """Replace a rule's pipeline wholesale, inside the caller's transaction.

    Delete-then-insert rather than a diff: step numbers are positional, so a
    diff would have to reason about moves, and a half-applied reorder is a
    pipeline that does something nobody wrote.
    """
    await conn.execute("DELETE FROM staging.niyam_rule_steps WHERE rule_id=$1::text",
                       rule_id)
    for s in steps:
        await conn.execute(
            "INSERT INTO staging.niyam_rule_steps (step_id, rule_id, step_no, kind, config) "
            "VALUES ($1::text, $2::text, $3::int, $4::text, $5::jsonb)",
            f"nstep_{uuid.uuid4().hex[:12]}", rule_id, s["step_no"], s["kind"],
            json.dumps(s["config"]))


@router.post("/rules", status_code=201)
async def create_rule(body: RuleIn, org_id: str = Depends(get_org_id),
                      user=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    """Create a rule. It is born DISABLED and UNARMED, whatever the client sends.

    There is no field on this endpoint to switch either on. Turning a rule on is
    a separate, deliberate act against a rule you can already see the preview
    for — never a side effect of creating it.
    """
    try:
        validate_event_type(body.event_type)
        steps = validate_steps(body.event_type,
                               [s.model_dump() for s in body.steps])
    except RuleInvalid as exc:
        raise _invalid(exc)

    name = (body.name or "").strip()
    if not name:
        raise HTTPException(422, detail={"error": "A rule needs a name.", "field": "name"})

    rule_id = f"nrule_{uuid.uuid4().hex[:12]}"
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO staging.niyam_rules "
                "(rule_id, org_id, name, event_type, created_by) "
                "VALUES ($1::text, $2::uuid, $3::text, $4::text, $5::text)",
                rule_id, org_id, name, body.event_type,
                (user or {}).get("user_id") if isinstance(user, dict) else None)
            await _write_steps(conn, rule_id, steps)
    return {"rule_id": rule_id, "enabled": False, "is_armed": False}


@router.patch("/rules/{rule_id}")
async def patch_rule(rule_id: str, body: RulePatch,
                     org_id: str = Depends(get_org_id),
                     _=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    pool = await get_pool()
    rule, _existing = await _load(pool, org_id, rule_id)

    steps = None
    if body.steps is not None:
        try:
            steps = validate_steps(rule["event_type"],
                                   [s.model_dump() for s in body.steps])
        except RuleInvalid as exc:
            raise _invalid(exc)

    if body.is_armed:
        # ARMING REQUIRES EVIDENCE. A rule may only be armed once it has
        # actually run in dry mode, because the entire safety story of this
        # design is "see it happen before you trust it" — and a rule that has
        # never matched anything is one whose author has seen nothing.
        seen = await pool.fetchval(
            "SELECT count(*) FROM staging.niyam_runs WHERE rule_id=$1::text", rule_id)
        if not seen:
            raise HTTPException(422, detail={
                "error": ("This rule has never run, so there is nothing to judge "
                          "it by. Turn it on and let it record a few dry runs "
                          "first — then arm it."),
                "field": "is_armed"})

    sets, vals = [], []
    for col, val in (("name", (body.name or "").strip() if body.name is not None else None),
                     ("enabled", body.enabled), ("is_armed", body.is_armed)):
        if val is not None and val != "":
            sets.append(f"{col} = ${len(vals) + 1}")
            vals.append(val)

    async with pool.acquire() as conn:
        async with conn.transaction():
            if sets:
                vals.extend([rule_id, org_id])
                await conn.execute(
                    f"UPDATE staging.niyam_rules SET {', '.join(sets)}, updated_at = NOW() "
                    f"WHERE rule_id = ${len(vals) - 1}::text AND org_id = ${len(vals)}::uuid",
                    *vals)
            if steps is not None:
                await _write_steps(conn, rule_id, steps)
    return await get_rule(rule_id, org_id=org_id, _=None)


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, org_id: str = Depends(get_org_id),
                      _=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    """Deletes the rule AND its history — the runs cascade.

    Named here because it is a real loss: the run history is the record of what
    this automation did to people's tasks. Disabling keeps it; deleting does not.
    """
    pool = await get_pool()
    await _load(pool, org_id, rule_id)
    await pool.execute(
        "DELETE FROM staging.niyam_rules WHERE rule_id=$1::text AND org_id=$2::uuid",
        rule_id, org_id)
    return {"deleted": rule_id}


@router.post("/rules/from-template/{template_id}", status_code=201)
async def clone_template(template_id: str, org_id: str = Depends(get_org_id),
                         user=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    t = by_id(template_id)
    if t is None:
        raise HTTPException(404, "No such template")
    return await create_rule(
        RuleIn(name=t["name"], event_type=t["event_type"],
               steps=[StepIn(**s) for s in t["steps"]]),
        org_id=org_id, user=user)


# ── the preview ──────────────────────────────────────────────────────────────

@router.post("/rules/{rule_id}/preview")
async def preview(rule_id: str, org_id: str = Depends(get_org_id),
                  _=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    """Replay this rule against real recent events. WRITES NOTHING.

    No run rows, no notifications, no `processed_at`. The events are read with
    no lock and no update — a preview must never consume the backlog the engine
    is about to drain.
    """
    pool = await get_pool()
    rule, step_rows = await _load(pool, org_id, rule_id)
    steps = _steps_out(step_rows)
    conditions = [s["config"] for s in steps if s["kind"] == "condition"]
    actions = [s["config"] for s in steps if s["kind"] == "action"]

    events = await pool.fetch(
        """
        SELECT event_id, occurred_at, entity_id, payload
          FROM staging.niyam_events
         WHERE org_id = $1::uuid AND event_type = $2::text
         ORDER BY event_id DESC
         LIMIT $3::int
        """,
        org_id, rule["event_type"], PREVIEW_EVENTS)

    matched, sample = 0, []
    for e in events:
        payload = e["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        verdict = evaluate_all(payload, rule["event_type"], conditions)
        if verdict.outcome == "ok":
            matched += 1
        if len(sample) < 20:
            sample.append({
                "event_id": e["event_id"],
                "occurred_at": e["occurred_at"].isoformat(),
                "entity_id": e["entity_id"],
                "outcome": verdict.outcome,
                "reason": verdict.reason,
                "detail": verdict.detail,
            })

    return {
        "considered": len(events),
        "matched": matched,
        "would_do": [{"verb": a.get("verb"), "config": a} for a in actions],
        "sample": sample,
        # Said plainly, because "0 of 0" is the answer people will see first and
        # it means "no traffic yet", not "your rule is wrong".
        "note": ("No events of this type have been recorded yet, so there is "
                 "nothing to preview against."
                 if not events else
                 f"{matched} of the last {len(events)} events would have matched."),
        "flags": describe(),
    }


# ── honest history ───────────────────────────────────────────────────────────

@router.get("/rules/{rule_id}/runs")
async def runs(rule_id: str, limit: int = 50,
               org_id: str = Depends(get_org_id),
               _=Depends(require_org_role(*ORG_SETTINGS_ROLES))):
    """What this rule actually did, per run, per step.

    Every step carries the values that were compared. That is the answer to "why
    did my rule not fire" — the question the old engine answered into a server
    log, on a rule its UI showed as Active.
    """
    pool = await get_pool()
    await _load(pool, org_id, rule_id)
    rows = await pool.fetch(
        """
        SELECT r.run_id, r.event_id, r.dry_run, r.started_at, r.finished_at, r.wake_at,
               COALESCE(
                 (SELECT json_agg(json_build_object(
                            'step_no', s.step_no, 'outcome', s.outcome,
                            'detail', s.detail, 'outbound_id', s.outbound_id)
                          ORDER BY s.step_no)
                    FROM staging.niyam_run_steps s WHERE s.run_id = r.run_id),
                 '[]'::json) AS steps
          FROM staging.niyam_runs r
         WHERE r.rule_id = $1::text AND r.org_id = $2::uuid
         ORDER BY r.started_at DESC
         LIMIT $3::int
        """,
        rule_id, org_id, max(1, min(limit, 200)))

    out = []
    for r in rows:
        d = dict(r)
        d["steps"] = json.loads(d["steps"]) if isinstance(d["steps"], str) else d["steps"]
        for k in ("started_at", "finished_at", "wake_at"):
            if d.get(k) is not None:
                d[k] = d[k].isoformat()
        out.append(d)
    return {"runs": out}
