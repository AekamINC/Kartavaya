"""
Creating a template with a data step — what the validator lets through.

`create_skill_template` required a valid `agent_type` AND a non-empty
`prompt_template` on EVERY step. A data step has neither, so the dispatcher's
function path could not be authored through the API even once the registry and
the calling convention were repaired. Fixing the run path without this would
have left the feature reachable only by writing rows by hand.

The write gate is the part that matters most here. Skill templates are org data
that any org admin can author through Create Template, and ten of the registered
functions write: `generate_due_invoices` raises invoices, `send_campaign`
messages customers, `execute_onboarding` creates records against an employee.
The run path refuses those without `allow_writes`, and so does this — a refusal
that lands while someone is authoring is worth more than the same refusal
mid-run, because only one of them has a person present to read it.
"""
import pytest

from services.skill_dispatcher import (
    SKILL_REGISTRY, WRITE_SKILL_FUNCTIONS, UNIMPLEMENTED_SKILL_FUNCTIONS,
)

ORG = "00000000-0000-0000-0000-00000000000a"


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """Module entitlement is tested elsewhere; this is about what happens after."""
    from routers.hub import _hub_gate
    app.dependency_overrides[_hub_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_hub_gate, None)


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG
    yield ORG
    app.dependency_overrides.pop(get_org_id, None)


def _body(steps, **kw):
    return {"name": "Test pack", "description": "", "category": "general",
            "icon": "star", "steps": steps, **kw}


async def _post(api_client, mock_pool, steps, **kw):
    async def _fetchrow(query, *args):
        if "INSERT INTO staging.hub_skill_templates" in query:
            # Echo enough of the row back that the handler can build its reply.
            return {"id": "11111111-1111-1111-1111-111111111111",
                    "name": args[0], "steps": args[3], "estimated_credits": args[4]}
        return None

    mock_pool.fetchrow.side_effect = _fetchrow
    return await api_client.post("/api/v1/hub/skills/templates", json=_body(steps, **kw))


# ── data steps are accepted at all ──────────────────────────────────────────

async def test_a_data_step_is_accepted_without_a_prompt(api_client, mock_pool, as_admin, org_a):
    """The refusal that made the whole feature unauthorable."""
    r = await _post(api_client, mock_pool, [
        {"skill_function": "find_overdue_invoices", "label": "Overdue invoices"},
    ])

    assert r.status_code == 200, r.text


async def test_a_mixed_template_is_accepted(api_client, mock_pool, as_admin, org_a):
    """The shape every useful skill has: read, then write about what was read."""
    r = await _post(api_client, mock_pool, [
        {"skill_function": "aggregate_kpis"},
        {"agent_type": "email", "prompt_template": "Summarise the figures above.",
         "context": ["kpis", "receivables"]},
    ])

    assert r.status_code == 200, r.text


async def test_an_ai_step_still_needs_a_prompt(api_client, mock_pool, as_admin, org_a):
    """The original rule, unchanged for the kind of step it was written for."""
    r = await _post(api_client, mock_pool, [{"agent_type": "email", "prompt_template": "  "}])

    assert r.status_code == 400
    assert "prompt_template" in r.text


# ── and only the ones that exist ────────────────────────────────────────────

async def test_an_unknown_skill_function_is_refused(api_client, mock_pool, as_admin, org_a):
    r = await _post(api_client, mock_pool, [{"skill_function": "definitely_not_a_thing"}])

    assert r.status_code == 400
    assert "unknown skill function" in r.text


@pytest.mark.parametrize("fn", sorted(UNIMPLEMENTED_SKILL_FUNCTIONS))
async def test_a_named_but_unimplemented_function_is_refused(
    fn, api_client, mock_pool, as_admin, org_a,
):
    """
    The six the old registry promised and nothing could honour. Refusing them by
    name — rather than letting them fall through as merely 'unknown' — is what
    keeps the distinction visible: these were real product intentions, and a
    template that referenced one would fail at run time with no explanation of
    why the name looked valid.
    """
    r = await _post(api_client, mock_pool, [{"skill_function": fn}])

    assert r.status_code == 400
    assert "no implementation" in r.text


# ── the write gate ──────────────────────────────────────────────────────────

#: Handlers that cannot be scoped to one organisation, so they are refused
#: before the write gate is ever reached. Four of them also write, which is why
#: the parametrised test below cannot assert one message for all ten.
UNSCOPABLE = {
    "escalate", "execute_sequence_step", "notify_multi",
    "score_candidate", "send_campaign",
}


@pytest.mark.parametrize("fn", sorted(WRITE_SKILL_FUNCTIONS))
async def test_every_write_function_is_refused_without_confirmation(
    fn, api_client, mock_pool, as_admin, org_a,
):
    """
    Every writing handler is refused unless the step confirms it — and the four
    that ALSO cannot be tenant-scoped are refused for that reason first, because
    an unscopable handler can never run at all. Both are refusals; asserting the
    wrong one would pass a template that must not exist.
    """
    r = await _post(api_client, mock_pool, [{"skill_function": fn}])

    assert r.status_code == 400, f"{fn} was accepted without allow_writes"
    if fn in UNSCOPABLE:
        assert "cannot be scoped" in r.text
    else:
        assert "allow_writes" in r.text


@pytest.mark.parametrize("fn", sorted(UNSCOPABLE))
async def test_an_unscopable_function_is_refused_even_when_confirmed(
    fn, api_client, mock_pool, as_admin, org_a,
):
    """
    `allow_writes` is consent to write inside YOUR organisation. It is not
    consent to run a handler that selects by an entity id with no org filter —
    that reads another tenant's row, and no author can consent to that on the
    other tenant's behalf.
    """
    r = await _post(api_client, mock_pool, [{"skill_function": fn, "allow_writes": True}])

    assert r.status_code == 400
    assert "cannot be scoped" in r.text


async def test_a_write_function_is_accepted_once_confirmed(api_client, mock_pool, as_admin, org_a):
    """Opt-in, not prohibition. The author may still choose it deliberately."""
    r = await _post(api_client, mock_pool, [
        {"skill_function": "generate_due_invoices", "allow_writes": True},
    ])

    assert r.status_code == 200, r.text


async def test_read_functions_need_no_confirmation(api_client, mock_pool, as_admin, org_a):
    reads = sorted(set(SKILL_REGISTRY) - WRITE_SKILL_FUNCTIONS)[:3]

    for fn in reads:
        r = await _post(api_client, mock_pool, [{"skill_function": fn}])
        assert r.status_code == 200, f"{fn}: {r.text}"


# ── context sources ─────────────────────────────────────────────────────────

async def test_an_unknown_context_source_is_refused(api_client, mock_pool, as_admin, org_a):
    """
    Caught at authoring time. Otherwise the only symptom is an 'unavailable'
    line in a context block at run time, long after whoever typed it has gone.
    """
    r = await _post(api_client, mock_pool, [
        {"agent_type": "email", "prompt_template": "Write it.", "context": ["invoicez"]},
    ])

    assert r.status_code == 400
    assert "unknown context source" in r.text


async def test_context_is_allowed_on_a_data_step_too(api_client, mock_pool, as_admin, org_a):
    r = await _post(api_client, mock_pool, [
        {"skill_function": "aggregate_kpis", "context": ["knowledge"]},
    ])

    assert r.status_code == 200, r.text


# ── pricing ─────────────────────────────────────────────────────────────────

#: The two rows migration 095 seeds that this section needs. Served through
#: `pool.fetch` because that is how `credits.price_of` reads them — the estimate
#: now resolves every AI step against `staging.credit_prices`, and a pool whose
#: `fetch` answers `[]` makes every price unknown and every estimate 0.
_PRICES = [
    {"kind": "email", "credits": 2, "unit_size": 1, "is_active": True},
    {"kind": "blog", "credits": 5, "unit_size": 1, "is_active": True},
]


def _serve_prices(mock_pool):
    async def _fetch(query, *args):
        if "FROM staging.credit_prices" in query:
            return _PRICES
        return []

    mock_pool.fetch.side_effect = _fetch


def _capture_estimate(mock_pool, captured):
    async def _fetchrow(query, *args):
        if "INSERT INTO staging.hub_skill_templates" in query:
            captured["estimated"] = args[4]
            return {"id": "11111111-1111-1111-1111-111111111111"}
        return None

    mock_pool.fetchrow.side_effect = _fetchrow


async def test_data_steps_are_not_priced(api_client, mock_pool, as_admin, org_a):
    """
    They call no model. The old sum used `CREDIT_COSTS.get(s["agent_type"], 2)`,
    whose fallback would have quoted 2 credits a step for work that is free —
    and raised KeyError on the way, since a data step has no `agent_type`.

    Asserted against `credits.price_of` rather than against `CREDIT_COSTS`. That
    dict no longer prices anything: `staging.credit_prices` does, `price_of` is
    the only function allowed to read it, and the table is editable without a
    deploy. An assertion against the dict would agree with the handler today and
    stop meaning anything the morning a price changes.
    """
    _serve_prices(mock_pool)
    captured = {}
    _capture_estimate(mock_pool, captured)

    r = await api_client.post("/api/v1/hub/skills/templates", json=_body([
        {"skill_function": "aggregate_kpis"},
        {"skill_function": "find_overdue_invoices"},
        {"agent_type": "email", "prompt_template": "Summarise."},
    ]))

    assert r.status_code == 200, r.text

    from services import credits
    assert captured["estimated"] == await credits.price_of(mock_pool, "skill_step", "email")


async def test_the_estimate_sums_the_ai_steps(api_client, mock_pool, as_admin, org_a):
    """Two priced steps, two prices. The counterpart to the test above: proving
    data steps add nothing is only half the claim if nothing proves the AI steps
    still add what they cost."""
    _serve_prices(mock_pool)
    captured = {}
    _capture_estimate(mock_pool, captured)

    r = await api_client.post("/api/v1/hub/skills/templates", json=_body([
        {"agent_type": "blog", "prompt_template": "Write the post."},
        {"skill_function": "aggregate_kpis"},
        {"agent_type": "email", "prompt_template": "Send it round."},
    ]))

    assert r.status_code == 200, r.text

    from services import credits
    assert captured["estimated"] == (
        await credits.price_of(mock_pool, "skill_step", "blog")
        + await credits.price_of(mock_pool, "skill_step", "email")
    )


async def test_an_unpriced_step_is_omitted_rather_than_refusing_the_template(
    api_client, mock_pool, as_admin, org_a,
):
    """
    A missing price row is a gap in the catalogue, not a mistake by the author.

    `estimated_credits` is the "about N credits" figure on the catalog card and
    prices nothing — the charge is resolved step by step at run time. So a kind
    the price table has not been given yet is left out of the estimate and the
    Save succeeds, rather than failing in front of the one person who cannot fix
    it. The kind used here is a valid `agent_type` with no row served above.
    """
    _serve_prices(mock_pool)
    captured = {}
    _capture_estimate(mock_pool, captured)

    r = await api_client.post("/api/v1/hub/skills/templates", json=_body([
        {"agent_type": "social_media", "prompt_template": "Post it."},
        {"agent_type": "email", "prompt_template": "Summarise."},
    ]))

    assert r.status_code == 200, r.text

    from services import credits
    assert captured["estimated"] == await credits.price_of(mock_pool, "skill_step", "email")


# ── capabilities ────────────────────────────────────────────────────────────

async def test_capabilities_lists_what_the_editor_needs(api_client, mock_pool, as_admin, org_a):
    """The step editor builds its pickers from this. A second copy of the
    registry in the frontend would drift, and the drift would be a template
    naming a handler that does not exist."""
    r = await api_client.get("/api/v1/hub/skills/capabilities")

    assert r.status_code == 200, r.text
    body = r.json()

    names = {f["name"] for f in body["skill_functions"]}
    assert names == set(SKILL_REGISTRY)

    # Every entry still RESOLVES to real code — that is what the registry rebuild
    # fixed. `available` now carries a second meaning on top: whether the handler
    # can be scoped to one organisation. The seven that cannot are reported
    # unavailable with a reason, so the editor does not offer a step that saves
    # cleanly and can never run.
    unavailable = {f["name"] for f in body["skill_functions"] if not f["available"]}
    assert unavailable == UNSCOPABLE, (
        "the editor's unavailable set drifted from the run guard's"
    )
    for f in body["skill_functions"]:
        if not f["available"]:
            assert "org_id" in f.get("unavailable_reason", ""), f"{f['name']} gives no reason"

    writes = {f["name"] for f in body["skill_functions"] if f["writes"]}
    assert writes == WRITE_SKILL_FUNCTIONS

    from services.skills.context import SOURCES
    assert {s["key"] for s in body["context_sources"]} == set(SOURCES)
    assert set(body["unimplemented"]) == UNIMPLEMENTED_SKILL_FUNCTIONS
