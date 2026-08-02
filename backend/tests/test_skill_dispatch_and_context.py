"""
The data-first skill path — registry, calling convention, and grounding.

None of this had ever executed. Three independent faults each sufficient to stop
any function-backed step before it reached a query:

  · every SKILL_REGISTRY entry named a module that does not exist
    (`services.skills.ganit` and seven siblings), so `_resolve_handler` raised
    ModuleNotFoundError;
  · `_run_function_step` called `handler(pool=, org_id=, user_id=, **params)`
    while not one of the 23 handlers accepts `user_id`, and several take
    `team_id` or an entity id rather than `org_id` — TypeError;
  · nothing built context, so a skill that did run would still have been
    reasoning from the brand profile alone.

Nothing failed loudly because no template has ever carried a `skill_function`
step. These are the checks that would have caught all three.
"""
import importlib
import inspect

import pytest

from services.skill_dispatcher import (
    SKILL_REGISTRY, WRITE_SKILL_FUNCTIONS, UNIMPLEMENTED_SKILL_FUNCTIONS,
    _run_function_step,
)
from services.skills import context as ctxmod

ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"
USER = "user_test001"


# ── The registry points at code that exists ─────────────────────────────────

@pytest.mark.parametrize("name", sorted(SKILL_REGISTRY))
def test_every_registry_entry_resolves_to_a_real_async_handler(name):
    """
    The check the old registry could not survive. All 17 of its entries named
    modules nobody wrote, and the 23 handlers that DO exist were referenced by
    nothing at all.
    """
    module_path, fn_name, defaults = SKILL_REGISTRY[name]

    module = importlib.import_module(module_path)
    handler = getattr(module, fn_name, None)

    assert handler is not None, f"{module_path}.{fn_name} does not exist"
    assert inspect.iscoroutinefunction(handler), f"{name} is not awaitable"
    assert isinstance(defaults, dict)


@pytest.mark.parametrize("name", sorted(SKILL_REGISTRY))
def test_registry_defaults_are_parameters_the_handler_actually_takes(name):
    """A default the signature does not name is dead config — it looks like it
    is doing something and silently is not."""
    module_path, fn_name, defaults = SKILL_REGISTRY[name]
    handler = getattr(importlib.import_module(module_path), fn_name)
    params = inspect.signature(handler).parameters

    unknown = [k for k in defaults if k not in params]
    assert not unknown, f"{name} defaults {unknown} are not parameters of {fn_name}"


def test_write_handlers_are_all_registered():
    """The gate is only a gate if every writing handler is behind it."""
    assert WRITE_SKILL_FUNCTIONS <= set(SKILL_REGISTRY)


def test_unimplemented_names_are_not_silently_registered():
    """The six that have no implementation must not resolve to a lookalike.

    `ganit_categorize_expenses` in particular: `check_policy` judges one expense
    against policy and does not classify anything, so mapping it there would run
    the wrong function under the right name.
    """
    assert not (UNIMPLEMENTED_SKILL_FUNCTIONS & set(SKILL_REGISTRY))


# ── The calling convention matches the handlers ─────────────────────────────

class _Pool:
    async def fetchval(self, *a, **kw):
        return None


@pytest.fixture
def spy(monkeypatch):
    """Register a fake handler and capture exactly what it was called with."""
    seen = {}

    def _install(name, fn, defaults=None, write=False):
        module = type(inspect)("fake_skill_module")
        module.handler = fn
        monkeypatch.setitem(
            __import__("sys").modules, "tests._fake_skill_module", module
        )
        monkeypatch.setitem(
            SKILL_REGISTRY, name, ("tests._fake_skill_module", "handler", defaults or {})
        )
        if write:
            monkeypatch.setattr(
                "services.skill_dispatcher.WRITE_SKILL_FUNCTIONS",
                WRITE_SKILL_FUNCTIONS | {name},
            )
        return seen

    _install.seen = seen
    return _install


@pytest.mark.asyncio
async def test_handler_is_given_only_what_its_signature_names(spy):
    """
    The TypeError that made every function step unreachable. The dispatcher used
    to pass `user_id` unconditionally; no handler in the tree accepts it.
    """
    got = {}

    async def handler(pool, org_id, module, days_overdue=0):
        got.update(org_id=org_id, module=module, days_overdue=days_overdue)
        return {"rows": 3}

    spy("fake_read", handler, {"module": "invoices", "days_overdue": 7})

    result = await _run_function_step(
        _Pool(), {"skill_function": "fake_read"}, {"brand_name": "Aekam"}, ORG, USER
    )

    assert result == {"rows": 3}
    assert got == {"org_id": ORG, "module": "invoices", "days_overdue": 7}


@pytest.mark.asyncio
async def test_org_id_cannot_be_overridden_by_template_data(spy):
    """
    The tenant boundary. Skill templates are org data that customers can author
    through Create Template, so a step able to set its own `org_id` would read
    another customer's invoices with the platform's own credentials.
    """
    got = {}

    async def handler(pool, org_id):
        got["org_id"] = org_id
        return {}

    spy("fake_scoped", handler)

    await _run_function_step(
        _Pool(),
        {"skill_function": "fake_scoped", "params": {"org_id": OTHER_ORG}},
        {"org_id": OTHER_ORG},
        ORG,
        USER,
    )

    assert got["org_id"] == ORG, "step params escaped the tenant boundary"


@pytest.mark.asyncio
async def test_run_variables_cannot_redirect_a_data_step(spy):
    """
    The cross-MODULE hole.

    `variables` is whatever the person pressing Run typed, and it used to be
    merged over both the registry defaults and the step's own params. So a step
    authored to read tasks was redirected into the receivables ledger by a run
    variable of {"module": "invoices"} — a Srijan-only user reading the books
    through a skill whose description says it reads tasks.

    Handler arguments come from the registry and the TEMPLATE. Never from the
    runner.
    """
    got = {}

    async def handler(pool, org_id, module, days_overdue=0):
        got.update(module=module, days_overdue=days_overdue)
        return {}

    spy("fake_redirect", handler, {"module": "tasks"})

    await _run_function_step(
        _Pool(),
        {"skill_function": "fake_redirect", "params": {"module": "tasks"}},
        {"module": "invoices", "days_overdue": 9999},     # the attack
        ORG,
        USER,
    )

    assert got["module"] == "tasks", "a run variable redirected the data step"
    assert got["days_overdue"] == 0, "a run variable reached a handler argument"


@pytest.mark.asyncio
async def test_a_handler_that_cannot_be_org_scoped_is_refused(spy):
    """
    The cross-TENANT hole, and the worse of the two.

    org_id was forced into the argument dict under a comment reading "never
    overridable", then filtered back out for every handler whose signature does
    not name it. Seven registered handlers are in that position and each selects
    by a team or entity id with no org filter of its own, so a template naming
    another tenant's id read another tenant's row.

    There is no way to scope such a handler from outside — the filter belongs in
    its query — so it is refused until the handler itself takes org_id.
    """
    called = False

    async def handler(pool, entity_type, entity_id, level=1):
        nonlocal called
        called = True
        return {}

    spy("fake_unscoped", handler)

    with pytest.raises(PermissionError, match="org_id"):
        await _run_function_step(
            _Pool(),
            {"skill_function": "fake_unscoped",
             "params": {"entity_type": "invoice", "entity_id": "someone-elses-uuid"}},
            {}, ORG, USER,
        )

    assert not called


def test_every_registered_handler_can_be_scoped_to_a_tenant():
    """
    The standing check, so a handler cannot be added to the registry without an
    org filter and only be caught at run time by the guard above.

    Seven entries failed this when the guard landed. Two have since been fixed —
    `scan_upcoming_deadlines` and `get_team_workload` now take org_id and scope
    their tasks through the teams subquery — so the list is five. It turns green
    one name at a time, and the assertion at the bottom REFUSES to let a fixed
    handler stay listed, which is what forced this edit.
    """
    KNOWN_UNSCOPED = {
        "escalate", "execute_sequence_step", "notify_multi",
        "score_candidate", "send_campaign",
    }

    unscoped = set()
    for name, (module_path, fn_name, _) in SKILL_REGISTRY.items():
        handler = getattr(importlib.import_module(module_path), fn_name)
        params = inspect.signature(handler).parameters
        if not any(p.kind is p.VAR_KEYWORD for p in params.values()) and "org_id" not in params:
            unscoped.add(name)

    new = unscoped - KNOWN_UNSCOPED
    assert not new, f"new handler(s) registered with no org scope: {sorted(new)}"

    fixed = KNOWN_UNSCOPED - unscoped
    assert not fixed, (
        f"{sorted(fixed)} now take org_id — remove them from KNOWN_UNSCOPED so "
        f"the list stays an accurate record of what is still unavailable."
    )


@pytest.mark.asyncio
async def test_a_missing_required_param_raises_before_the_handler_runs(spy):
    """
    Fails closed. `find_overdue` without `module` would scan whichever table a
    default happened to name; a write handler without its id would write the
    wrong rows.
    """
    called = False

    async def handler(pool, org_id, week_start):
        nonlocal called
        called = True
        return {}

    spy("fake_needs_week", handler)

    with pytest.raises(ValueError, match="week_start"):
        await _run_function_step(
            _Pool(), {"skill_function": "fake_needs_week"}, {}, ORG, USER
        )

    assert not called


@pytest.mark.asyncio
async def test_write_handlers_refuse_without_an_explicit_opt_in(spy):
    """`send_campaign` reaches customers and `generate_due_invoices` reaches
    money. A template edit must not be able to acquire either by accident."""
    async def handler(pool, org_id):
        return {"sent": 1}

    spy("fake_write", handler, write=True)

    with pytest.raises(PermissionError, match="allow_writes"):
        await _run_function_step(
            _Pool(), {"skill_function": "fake_write"}, {}, ORG, USER
        )

    ok = await _run_function_step(
        _Pool(), {"skill_function": "fake_write", "allow_writes": True}, {}, ORG, USER
    )
    assert ok == {"sent": 1}


@pytest.mark.asyncio
async def test_non_dict_handler_results_are_wrapped(spy):
    """Half the read handlers return a list."""
    async def handler(pool, org_id):
        return [1, 2, 3]

    spy("fake_list", handler)

    assert await _run_function_step(
        _Pool(), {"skill_function": "fake_list"}, {}, ORG, USER
    ) == {"result": [1, 2, 3]}


# ── Context: simple and rich, and honest when a source is missing ───────────

@pytest.mark.asyncio
async def test_one_failing_source_does_not_take_the_others_with_it(monkeypatch):
    """
    A KB whose embedding provider is down should cost the documents, not the
    receivables. Both are reported; neither is silently dropped.
    """
    async def boom(pool, org_id, **kw):
        raise RuntimeError("embeddings unavailable")

    async def fine(pool, org_id, **kw):
        return [{"entity": {"label": "INV-001"}, "days_past": 63}]

    monkeypatch.setattr(ctxmod.SOURCES["knowledge"], "fetch", boom)
    monkeypatch.setattr(ctxmod.SOURCES["receivables"], "fetch", fine)

    ctx = await ctxmod.build_context(_Pool(), ORG, ["receivables", "knowledge"])

    assert ctx["receivables"]["ok"] is True
    assert ctx["knowledge"]["ok"] is False

    rendered = ctxmod.render_context(ctx)
    assert "INV-001" in rendered
    assert "Unavailable" in rendered
    assert "not as empty" in rendered


@pytest.mark.asyncio
async def test_an_unknown_source_is_reported_not_ignored():
    """A template naming a source that does not exist must say so, rather than
    grounding on nothing and reading as if it had data."""
    ctx = await ctxmod.build_context(_Pool(), ORG, ["nonesuch"])

    assert ctx["nonesuch"]["ok"] is False
    assert "no such context source" in ctx["nonesuch"]["error"]


def test_truncation_is_named_never_silent():
    """
    A truncated context block reads exactly like a complete one, and the model
    will answer over half the data with the same confidence.
    """
    rows = [{"i": i, "pad": "x" * 40} for i in range(200)]
    ctx = {"receivables": {"ok": True, "label": "Overdue customer invoices",
                           "kind": "simple", "data": rows[:ctxmod.MAX_ROWS_PER_SOURCE],
                           "dropped": 200 - ctxmod.MAX_ROWS_PER_SOURCE}}

    rendered = ctxmod.render_context(ctx)

    assert "more not shown" in rendered
    assert str(200 - ctxmod.MAX_ROWS_PER_SOURCE) in rendered


def test_the_whole_block_is_bounded():
    """Context is tokens and tokens are the running cost of every step."""
    huge = {
        f"src{i}": {"ok": True, "label": f"Source {i}", "kind": "simple",
                    "data": [{"pad": "y" * 500} for _ in range(ctxmod.MAX_ROWS_PER_SOURCE)]}
        for i in range(40)
    }

    rendered = ctxmod.render_context(huge)

    assert len(rendered) <= ctxmod.MAX_CONTEXT_CHARS
    assert "Omitted for length" in rendered


def test_empty_context_renders_to_nothing():
    """A step that asks for no context must behave exactly as it did before this
    module existed — which is what keeps the six content templates unchanged."""
    assert ctxmod.render_context({}) == ""


@pytest.mark.asyncio
async def test_a_step_without_context_asks_for_nothing():
    step = {"agent_type": "social_media", "prompt_template": "Write a post."}

    assert await ctxmod.context_for_step(_Pool(), step, ORG, {}) == ""


@pytest.mark.asyncio
async def test_a_step_with_context_gets_a_grounded_block(monkeypatch):
    async def fine(pool, org_id, **kw):
        return {"revenue": 420000, "deals_won": 7}

    monkeypatch.setattr(ctxmod.SOURCES["kpis"], "fetch", fine)

    step = {"agent_type": "email", "context": ["kpis"],
            "prompt_template": "Draft the monthly update."}

    block = await ctxmod.context_for_step(_Pool(), step, ORG, {})

    assert "420000" in block
    assert "Ground every claim in it" in block
