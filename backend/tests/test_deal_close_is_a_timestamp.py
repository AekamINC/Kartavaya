"""A deal is closed by its TIMESTAMP, and the two write paths must agree.

── THE FINDING, SUITE 12.11 ON 2026-08-31 ──────────────────────────────────

The suite does not check a number; it checks that three readings of *one*
concept agree. "Open pipeline" is read in three places and they disagreed:

    GET /v1/dristi/overview   deals.pipeline_value  (the headline tile)
    the Pipeline tab's funnel                        (stage by stage)
    analytics.run graha.pipeline_by_stage            (the metric registry)

Two of them define open as `won_at IS NULL AND lost_at IS NULL AND
archived_at IS NULL`. The registry states the rule and gives the reason, so it
is quoted here rather than restated:

    "Open = not won, not lost, not archived, not deleted — the close is the
     won_at/lost_at timestamp, never a stage string, because stage values are
     per-org text."

That is the right rule: `stage` comes from the org's own
`graha_pipelines.stages` and a customer can rename "Won" to "Closed — Signed"
this afternoon. But a rule that reads a column only works if something WRITES
that column, and two paths did not.

── THE TWO HOLES, MEASURED LIVE (read-only) 2026-08-31 ─────────────────────

    won_stage_no_timestamp    5   ₹1,000,000  ┐ closed on screen,
    lost_stage_no_timestamp   3   ₹1,950,000  ┘ OPEN in every money figure
    open_stage_stale_won_at   1     ₹750,000    open on screen,
                                                CLOSED in every money figure

  · `create_deal` inserted `body.stage` verbatim and stamped nothing. A deal
    entered as Won — a sale logged after the fact, an import, a seed — was
    born closed on the board and open in the money, and nothing would ever
    move its stage again to trigger a stamp.
  · `update_deal` stamped on the way IN and cleared nothing on the way OUT, so
    a deal moved to Won and then back to Proposal — a deal that slips, the
    most ordinary event in a pipeline — kept `won_at` forever and was
    subtracted from open pipeline while sitting in an open column.

Both directions, one root cause, and neither produces an error or a log line.

── WHY THESE TESTS ASSERT ON BOUND PARAMETERS ──────────────────────────────

`stage='Won'` in the SQL would have passed a test that only checked a status
code, and so would stamping the wrong column. What matters is the PAIR OF
VALUES that reaches the row, so every test below reads the parameter actually
bound to `won_at` / `lost_at` and checks it against the one predicate the
metric will later apply. `test_the_pair_always_satisfies_the_metrics_predicate`
states that as a property over every stage, which is the assertion that would
have caught this before it shipped.

MUTATION-PROVED, four killers, run 2026-08-31:

    M1  create_deal stamps nothing (the shipped defect)          4 red
    M2  update_deal has no re-open branch (the shipped defect)   4 red
    M3  closing stamps but does not clear the opposite column    2 red
    M4  create_deal stamps EVERY deal, not only closing stages  10 red

M4 is the over-correction the naive fix produces, and it matters more than it
looks: it hides every newly created deal from the pipeline it was just added
to, which is a worse number than the one being fixed.
"""
import pytest

from routers import graha

OURS = "a0000000-0000-0000-0000-00000000000a"
DEAL = "d0000000-0000-0000-0000-000000000001"

# The two strings the product treats as closing. They are hardcoded in BOTH
# write paths and quoted here on purpose: if a fourth reading of "closed"
# appears, this list is where the disagreement shows up first.
CLOSING = ("Won", "Lost")
OPEN_STAGES = ("New", "Qualified", "Proposal", "Negotiation")


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.graha import _crm_entity_gate, _gate
    for dep in (_gate, _crm_entity_gate):
        app.dependency_overrides[dep] = lambda: None
    yield
    for dep in (_gate, _crm_entity_gate):
        app.dependency_overrides.pop(dep, None)


def sql_of(call):
    return " ".join(str(call.args[0]).split())


def find_call(pool, needle):
    for c in pool.fetchrow.call_args_list:
        if c.args and needle in sql_of(c):
            return c
    return None


@pytest.fixture
def scoped(mock_pool):
    """Answer the resolvers' org probes, and the default-pipeline lookup.

    Keyed on the SHAPE of the question rather than returning a blanket truthy
    value, for the reason `test_graha_deal_org_binding.py` gives: a blanket
    stub cannot tell a deleted guard from a satisfied one.
    """
    # `async def` on purpose: `as_admin` WRAPS whatever side_effect it finds and
    # awaits it, and this fixture is resolved before that one. A plain function
    # here fails with "'str' object can't be awaited" from conftest, which reads
    # like a product bug and is not one.
    async def answer(sql, *args):
        s = " ".join(str(sql).split())
        if "is_default=TRUE" in s:
            return OURS
        if s.startswith("SELECT 1 FROM public.graha_") and "org_id=$2::uuid" in s:
            return 1
        return None
    mock_pool.fetchval.side_effect = answer
    mock_pool.fetchrow.return_value = {
        "id": DEAL, "title": "T", "stage": "New", "value": 0,
        "client_id": None, "assigned_to": None, "created_by": "u1",
    }
    return mock_pool


# ── create_deal ─────────────────────────────────────────────────────────────

def insert_pair(pool):
    """(won_at, lost_at) as bound into the deal INSERT.

    Read by POSITION off the column list rather than by counting arguments, so
    the test still means what it says if a column is added in the middle.
    """
    call = find_call(pool, "INSERT INTO public.graha_deals")
    assert call is not None, "no deal INSERT was issued"
    sql = sql_of(call)
    cols = sql.split("(", 1)[1].split(")", 1)[0]
    names = [c.strip() for c in cols.split(",")]
    assert "won_at" in names and "lost_at" in names, (
        "the INSERT does not name won_at/lost_at at all — a deal created at a "
        f"closing stage can never be closed in the money. Columns: {names}")
    args = call.args[1:]
    return args[names.index("won_at")], args[names.index("lost_at")]


@pytest.mark.parametrize("stage", CLOSING)
async def test_a_deal_created_closed_is_stamped(
        stage, api_client, scoped, as_admin, with_org_id):
    """RED without the `_won_at`/`_lost_at` computation in `create_deal`:
    both parameters are absent and `insert_pair` fails on the column list."""
    resp = await api_client.post("/api/v1/graha/deals",
                                 json={"title": "T", "stage": stage})
    assert resp.status_code == 200
    won, lost = insert_pair(scoped)
    if stage == "Won":
        assert won is not None, "created as Won and open in every money figure"
        assert lost is None, "a won deal is not also lost"
    else:
        assert lost is not None, "created as Lost and open in every money figure"
        assert won is None, "a lost deal is not also won"


@pytest.mark.parametrize("stage", OPEN_STAGES)
async def test_a_deal_created_open_is_not_stamped(
        stage, api_client, scoped, as_admin, with_org_id):
    """The other half. Stamping unconditionally would hide every new deal from
    the pipeline it was just added to — a fix that is worse than the defect."""
    resp = await api_client.post("/api/v1/graha/deals",
                                 json={"title": "T", "stage": stage})
    assert resp.status_code == 200
    assert insert_pair(scoped) == (None, None)


async def test_the_default_stage_is_open(
        api_client, scoped, as_admin, with_org_id):
    """No `stage` in the body at all — the overwhelmingly common case, and the
    one a stamping bug would break silently for every deal in the product."""
    resp = await api_client.post("/api/v1/graha/deals", json={"title": "T"})
    assert resp.status_code == 200
    assert insert_pair(scoped) == (None, None)


# ── update_deal ─────────────────────────────────────────────────────────────

def update_sets(pool):
    """{column: bound value} for the deal UPDATE's SET list.

    Placeholders are resolved to their parameters, so a test can tell
    `won_at=$7` bound to a datetime from `won_at=$7` bound to None — which is
    the entire difference between the defect and the fix.
    """
    call = find_call(pool, "UPDATE public.graha_deals SET")
    assert call is not None, "no deal UPDATE was issued"
    sql = sql_of(call)
    body = sql.split("SET ", 1)[1].split(" WHERE ", 1)[0]
    args = call.args[1:]
    out = {}
    for frag in body.split(", "):
        col, _, expr = frag.partition("=")
        expr = expr.strip()
        if expr.startswith("$") and expr[1:].isdigit():
            out[col.strip()] = args[int(expr[1:]) - 1]
        else:
            out[col.strip()] = expr
    return out


async def patch_stage(api_client, stage):
    return await api_client.patch(f"/api/v1/graha/deals/{DEAL}",
                                  json={"stage": stage})


async def test_moving_to_won_stamps_won_and_clears_lost(
        api_client, scoped, as_admin, with_org_id):
    resp = await patch_stage(api_client, "Won")
    assert resp.status_code == 200
    sets = update_sets(scoped)
    assert sets["won_at"] is not None
    assert sets["lost_at"] is None, (
        "a deal that was Lost and is now Won stays lost to the metric")
    assert sets["probability"] == 100


async def test_moving_to_lost_stamps_lost_and_clears_won(
        api_client, scoped, as_admin, with_org_id):
    resp = await patch_stage(api_client, "Lost")
    assert resp.status_code == 200
    sets = update_sets(scoped)
    assert sets["lost_at"] is not None
    assert sets["won_at"] is None
    assert sets["probability"] == 0


@pytest.mark.parametrize("stage", OPEN_STAGES)
async def test_re_opening_clears_both_timestamps(
        stage, api_client, scoped, as_admin, with_org_id):
    """THE DEFECT ITSELF. RED without the `else` branch in `update_deal`:
    neither column appears in the SET list, so a Won deal dragged back to
    Proposal keeps `won_at` and is subtracted from open pipeline forever."""
    resp = await patch_stage(api_client, stage)
    assert resp.status_code == 200
    sets = update_sets(scoped)
    assert "won_at" in sets and "lost_at" in sets, (
        f"moving to {stage} left the close timestamps untouched")
    assert sets["won_at"] is None and sets["lost_at"] is None


@pytest.mark.parametrize("stage", OPEN_STAGES)
async def test_re_opening_does_not_invent_a_probability(
        stage, api_client, scoped, as_admin, with_org_id):
    """100 and 0 were written BY the close. Any other number is the rep's own
    estimate, and this path has nothing better to replace it with — so it must
    not write one."""
    await patch_stage(api_client, stage)
    assert "probability" not in update_sets(scoped)


async def test_a_patch_without_a_stage_leaves_the_close_alone(
        api_client, scoped, as_admin, with_org_id):
    """The deal drawer submits the whole form; a note edit must not re-open a
    won deal. `"stage" in updates` is the only trigger, and this holds it."""
    resp = await api_client.patch(f"/api/v1/graha/deals/{DEAL}",
                                  json={"notes": "spoke to finance"})
    assert resp.status_code == 200
    sets = update_sets(scoped)
    assert "won_at" not in sets and "lost_at" not in sets


# ── the property both paths exist to satisfy ────────────────────────────────

@pytest.mark.parametrize("stage", CLOSING + OPEN_STAGES)
async def test_the_pair_always_satisfies_the_metrics_predicate(
        stage, api_client, scoped, as_admin, with_org_id):
    """One assertion, both write paths, every stage.

    `graha.pipeline_by_stage` counts a deal as open exactly when
    `won_at IS NULL AND lost_at IS NULL`. So for any stage, through EITHER
    path, that predicate must equal "this stage is not a closing stage" — and
    the two paths must produce the same answer as each other, which is the
    reconciliation suite 12.11 was actually testing.
    """
    await api_client.post("/api/v1/graha/deals",
                          json={"title": "T", "stage": stage})
    created = insert_pair(scoped)

    scoped.fetchrow.call_args_list.clear()
    await patch_stage(api_client, stage)
    sets = update_sets(scoped)
    updated = (sets.get("won_at"), sets.get("lost_at"))

    expected_open = stage not in CLOSING
    assert (created == (None, None)) is expected_open, (
        f"create_deal disagrees with the metric about {stage!r}")
    assert (updated == (None, None)) is expected_open, (
        f"update_deal disagrees with the metric about {stage!r}")
    assert (created == (None, None)) == (updated == (None, None)), (
        f"the two write paths disagree with EACH OTHER about {stage!r} — the "
        "same deal reads open or closed depending on how it got there")
