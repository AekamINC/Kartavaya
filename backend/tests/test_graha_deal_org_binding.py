"""Every id a Graha write takes from a request body belongs to the caller's org.

WHY THIS FILE EXISTS
--------------------
Phase 7.1a closed `graha_deals.territory_id` and, in the same commit message,
NAMED the three ids it had not closed: `create_deal` bound `client_id`,
`contact_id` and `pipeline_id` straight into the INSERT with no check of any
kind. Sweeping for the SHAPE rather than the symptom found four more write
paths in the same router doing the same thing — `create_activity`,
`create_follow_up`, `create_document` and `update_document` — so the guard is
tested here as one property across all of them rather than as seven anecdotes.

THE SHAPE, stated once. Read live off `pg_constraint` on 2026-08-27, ten
foreign keys reach these tables from a request body and NOT ONE is composite
with `org_id`:

    graha_deals      -> graha_clients(id) / graha_contacts(id)
                        / graha_pipelines(id) / graha_territories(id)
    graha_activities -> graha_deals(id) / graha_contacts(id)
    graha_follow_ups -> graha_deals(id) / graha_contacts(id)
    graha_documents  -> graha_deals(id) / graha_contacts(id)

So the database accepts any id that exists ANYWHERE, and "the row inserted
fine" proves only that the uuid is real — never that it is the caller's. The
child row's own `org_id` does not help: it comes from the caller's session, so
a leaked row is stamped org A while pointing at a parent in org B and looks
perfectly well-formed from the child's side. That is why the live control is a
count of cross-org PAIRS, and why these tests assert on the JOINED id rather
than on a status code alone.

LIVE EXPOSURE, measured read-only before a line was changed (2026-08-27).
Every one of the ten came back ZERO — 163 deals, 218 activities, 135
follow-ups, 62 documents, no cross-org pair anywhere, no orphan ids, nothing on
an inactive parent. The leaks were LATENT, exactly as the territory one was.
That is a reason to close them calmly, not a reason to leave them: a latent
leak is one guessed uuid away from an active one, and `POST /deals` is
reachable by any authenticated member of any tenant.

HOW THESE TESTS ARE BUILT, and why not the source-inspection style used in
`test_territories.py`. A test that greps the handler for `resolve_...` passes
the moment the call is present and cannot tell whether the RESULT was used —
which is the exact bug that hid inside `create_deal` for as long as it did,
where `compute_lead_score` re-read the raw `body.contact_id` after the value
had been resolved. So these drive the real routes through the app and read
back the SQL parameters that were actually bound. Every one of them was proved
to go RED with the guard removed before it was kept.
"""
import pytest

from routers import graha

# A uuid from ANOTHER organisation. Well-formed, real somewhere, not ours.
FOREIGN = "f0000000-0000-0000-0000-0000000000ff"
OURS = "a0000000-0000-0000-0000-00000000000a"
DEAL = "d0000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """Both of this router's gates, as `test_graha.py` does.

    Overriding `_gate` alone would leave the client/contact routes running the
    real `_crm_entity_gate` against the mock pool, and this file would end up
    testing entitlements instead of the org binding it is about.
    """
    from routers.graha import _crm_entity_gate, _gate
    for dep in (_gate, _crm_entity_gate):
        app.dependency_overrides[dep] = lambda: None
    yield
    for dep in (_gate, _crm_entity_gate):
        app.dependency_overrides.pop(dep, None)


def scoped_fetchval(pool, *, allow=()):
    """Answer the resolvers' probes the way the real database would.

    Each resolver asks exactly one question — "is this id in THIS org and
    live?" — as `SELECT 1 FROM staging.<table> WHERE id=$1 AND org_id=$2 AND
    is_active=TRUE`. This stub answers 1 only for the ids in `allow`, which is
    what a correctly scoped database answers, and None for everything else,
    which is what it answers for another tenant's id.

    It deliberately keys on the TABLE and the ID rather than returning a blanket
    truthy value, because `mock_pool.fetchval` defaults to `0` in this suite:
    a resolver could be deleted entirely and a blanket stub would never notice.
    """
    def answer(sql, *args):
        s = " ".join(str(sql).split())
        if s.startswith("SELECT 1 FROM public.graha_") and "org_id=$2::uuid" in s:
            return 1 if args and args[0] in allow else None
        # The default-pipeline lookup in `create_deal` — a real id, this org's.
        if "is_default=TRUE" in s:
            return OURS
        return None
    pool.fetchval.side_effect = answer
    return pool


def sql_of(call):
    return " ".join(str(call.args[0]).split())


def find_call(pool, needle):
    for c in pool.fetchrow.call_args_list:
        if c.args and needle in sql_of(c):
            return c
    return None


# ── create_deal: the three ids named in the finding ──────────────────────────

@pytest.mark.parametrize("field,table", [
    ("client_id", "graha_clients"),
    ("contact_id", "graha_contacts"),
    ("pipeline_id", "graha_pipelines"),
    ("territory_id", "graha_territories"),
])
async def test_create_deal_refuses_another_orgs_id(
        field, table, api_client, mock_pool, as_admin, with_org_id):
    """The whole finding, one id at a time.

    RED WITHOUT THE GUARD: with the resolver call removed from `create_deal`
    each of these returns 200 and the foreign uuid is bound into the INSERT —
    verified by deleting the call and re-running, for all four.
    """
    scoped_fetchval(mock_pool, allow=())
    mock_pool.fetchrow.return_value = {
        "id": DEAL, "title": "T", "stage": "New", "value": 0,
        "client_id": None, "assigned_to": None, "created_by": "u1",
    }
    resp = await api_client.post("/api/v1/graha/deals",
                                 json={"title": "T", field: FOREIGN})
    assert resp.status_code == 400, (
        f"{field} from another organisation was accepted — the foreign key on "
        f"{table} is not composite with org_id, so nothing else stops it")
    assert find_call(mock_pool, "INSERT INTO public.graha_deals") is None, (
        "the deal was written before the id was refused")


async def test_create_deal_refusal_does_not_fall_through_to_the_default_pipeline(
        api_client, mock_pool, as_admin, with_org_id):
    """A refused pipeline must 400, never silently become the org's default.

    This is the failure mode a resolver that returns "" for a BAD id would
    have: `create_deal` reads "" as "none was named" and helpfully substitutes
    the caller's own default pipeline, so a cross-tenant attempt would come
    back 200 with a perfectly valid deal and the attacker would learn nothing
    — and neither would we. The refusal has to be loud.
    """
    scoped_fetchval(mock_pool, allow=())
    resp = await api_client.post("/api/v1/graha/deals",
                                 json={"title": "T", "pipeline_id": FOREIGN})
    assert resp.status_code == 400
    assert find_call(mock_pool, "INSERT INTO public.graha_pipelines") is None


async def test_create_deal_binds_the_resolved_ids_not_the_body(
        api_client, mock_pool, as_admin, with_org_id):
    """The happy path, asserted on the PARAMETERS rather than the status code.

    A guard that runs and is then ignored is the bug this file was written
    around: `compute_lead_score` re-read `body.contact_id` after the resolved
    value had been computed. So the assertion is that the values reaching the
    INSERT are the ones that came out of the resolvers.
    """
    scoped_fetchval(mock_pool, allow=(OURS,))
    mock_pool.fetchrow.return_value = {
        "id": DEAL, "title": "T", "stage": "New", "value": 0,
        "client_id": OURS, "assigned_to": None, "created_by": "u1",
    }
    resp = await api_client.post("/api/v1/graha/deals", json={
        "title": "T", "client_id": OURS, "contact_id": OURS,
        "pipeline_id": OURS, "territory_id": OURS,
    })
    assert resp.status_code == 200
    call = find_call(mock_pool, "INSERT INTO public.graha_deals")
    assert call is not None
    assert call.args.count(OURS) >= 4, (
        "the resolved ids did not all reach the INSERT")


async def test_the_lead_score_write_uses_the_resolved_contact(
        api_client, mock_pool, as_admin, with_org_id):
    """`compute_lead_score` WRITES to the contact row.

    It is not a read: it sets `lead_score` and `lead_score_reasons`. Both
    `create_deal` and `create_activity` called it with the raw body value, so
    even a perfectly guarded INSERT would have left one cross-tenant write
    behind on the way out of the handler. Asserted on the source because the
    call is fired into `asyncio.ensure_future` and never awaited by the route.
    """
    import inspect
    for fn in (graha.create_deal, graha.create_activity):
        src = inspect.getsource(fn)
        body = "\n".join(l for l in src.splitlines()
                         if not l.strip().startswith("#"))
        assert "compute_lead_score(pool, org_id, contact_id)" in body, (
            f"{fn.__name__} scores the UNRESOLVED contact id")
        assert "compute_lead_score(pool, org_id, body.contact_id)" not in body


# ── update_deal: the same ids, the easier attack ─────────────────────────────

@pytest.mark.parametrize("field", ["client_id", "contact_id", "pipeline_id",
                                   "territory_id"])
async def test_update_deal_refuses_another_orgs_id(
        field, api_client, mock_pool, as_admin, with_org_id):
    """A PATCH only has to guess ONE id — the deal is already the caller's.

    RED WITHOUT THE GUARD, verified per field by removing the resolver block:
    the route answers 200 and the UPDATE re-files the deal.
    """
    scoped_fetchval(mock_pool, allow=())
    resp = await api_client.patch(f"/api/v1/graha/deals/{DEAL}",
                                  json={field: FOREIGN})
    assert resp.status_code == 400
    assert find_call(mock_pool, "UPDATE public.graha_deals SET") is None


async def test_update_deal_refuses_to_take_a_deal_off_every_board(
        api_client, mock_pool, as_admin, with_org_id):
    """`pipeline_id=""` is refused rather than quietly dropped.

    The other three ids clear to NULL deliberately. This one must not:
    `deals_kanban` selects on `pipeline_id`, so a deal with none has left every
    board in the organisation while still counting in `list_deals` and in the
    CRM report — present in the totals, absent from every screen.
    """
    scoped_fetchval(mock_pool, allow=(OURS,))
    resp = await api_client.patch(f"/api/v1/graha/deals/{DEAL}",
                                  json={"pipeline_id": ""})
    assert resp.status_code == 400
    assert "pipeline" in resp.json()["detail"].lower()


async def test_pipeline_id_is_bound_as_a_uuid_not_an_untyped_parameter(
        api_client, mock_pool, as_admin, with_org_id):
    """It sat in `_DEAL_COLS` with no field behind it, so nobody ever hit this.

    The generic branch of the SET-build binds a bare `$n`, and an untyped
    parameter into a `uuid` column is the parse error PgBouncer turns into an
    instant 500 with no useful log. Giving `pipeline_id` a field would have
    armed that on the first person who moved a deal between boards.
    """
    scoped_fetchval(mock_pool, allow=(OURS,))
    mock_pool.fetchrow.return_value = {"id": DEAL, "stage": "New"}
    resp = await api_client.patch(f"/api/v1/graha/deals/{DEAL}",
                                  json={"pipeline_id": OURS})
    assert resp.status_code == 200
    call = find_call(mock_pool, "UPDATE public.graha_deals SET")
    assert "pipeline_id=NULLIF($" in sql_of(call) and "::uuid" in sql_of(call)


# ── Finding 2: the allowlist and the model had drifted apart ─────────────────

async def test_a_lost_reason_typed_by_a_person_is_actually_saved(
        api_client, mock_pool, as_admin, with_org_id):
    """THE FINDING, as a behaviour rather than a code shape.

    `lost_reason` was on `DealUpdate` and missing from `_DEAL_COLS`, so the
    dict comprehension that builds `updates` dropped it and the route answered
    200. A person moved a deal to Lost, typed why, saved, saw the drawer close
    — and nothing was written. It failed in the direction that looks like
    success, which is why it survived so long.

    Live control read read-only on 2026-08-27: 22 deals stand in stage `Lost`
    and only 2 carry a `lost_reason`, and neither of those two can have come
    through this route, because no request could ever set it.

    RED WITHOUT THE FIX: remove `"lost_reason"` from `_DEAL_COLS` and this test
    fails on the SET clause — while the route still returns 200, which is
    exactly the problem.
    """
    scoped_fetchval(mock_pool, allow=(OURS,))
    mock_pool.fetchrow.return_value = {"id": DEAL, "stage": "Lost"}
    resp = await api_client.patch(
        f"/api/v1/graha/deals/{DEAL}",
        json={"stage": "Lost", "lost_reason": "Price — went with the incumbent"})
    assert resp.status_code == 200
    call = find_call(mock_pool, "UPDATE public.graha_deals SET")
    assert call is not None, "no UPDATE was issued at all"
    assert "lost_reason=$" in sql_of(call), (
        "the reason a deal was lost was accepted by the model and then "
        "discarded before the SQL was built")
    assert "Price — went with the incumbent" in call.args, (
        "the column was named in the SET clause but the typed value never "
        "reached a parameter")


async def test_the_reason_can_also_be_cleared(
        api_client, mock_pool, as_admin, with_org_id):
    """`""` is a legitimate value on a text column and must reach the SET.

    A field that can be filled and never emptied is the same
    writable-and-unreachable shape one step later. It falls to the generic
    bare-`$n` branch on purpose: `lost_reason` is `text`, so the parameter type
    is unambiguous and this is NOT the untyped-into-`uuid` shape.
    """
    scoped_fetchval(mock_pool, allow=(OURS,))
    mock_pool.fetchrow.return_value = {"id": DEAL, "stage": "Lost"}
    resp = await api_client.patch(f"/api/v1/graha/deals/{DEAL}",
                                  json={"lost_reason": ""})
    assert resp.status_code == 200
    call = find_call(mock_pool, "UPDATE public.graha_deals SET")
    assert "lost_reason=$" in sql_of(call)
    assert "" in call.args


async def test_client_id_on_a_deal_is_no_longer_set_once_at_create(
        api_client, mock_pool, as_admin, with_org_id):
    """The other half of the same drift, and the same silent-200 failure."""
    scoped_fetchval(mock_pool, allow=(OURS,))
    mock_pool.fetchrow.return_value = {"id": DEAL, "stage": "New"}
    resp = await api_client.patch(f"/api/v1/graha/deals/{DEAL}",
                                  json={"client_id": OURS})
    assert resp.status_code == 200
    assert "client_id=NULLIF($" in sql_of(
        find_call(mock_pool, "UPDATE public.graha_deals SET"))


async def test_custom_data_survives_the_create_form(
        api_client, mock_pool, as_admin, with_org_id):
    """`custom_data` was allowlisted with no field behind it.

    `DealCreate` grew the field so a custom value could be entered on the new-
    deal form; without the matching field here it was then frozen for ever —
    fillable once, wrongly, and never correctable.
    """
    scoped_fetchval(mock_pool, allow=(OURS,))
    mock_pool.fetchrow.return_value = {"id": DEAL, "stage": "New"}
    resp = await api_client.patch(f"/api/v1/graha/deals/{DEAL}",
                                  json={"custom_data": {"po": "PO-91"}})
    assert resp.status_code == 200
    assert "custom_data=$" in sql_of(
        find_call(mock_pool, "UPDATE public.graha_deals SET"))


def test_the_model_and_the_allowlist_can_never_drift_apart_again():
    """The ratchet, and the reason this finding was possible at all.

    Two sets in two places, edited by different people at different times, with
    NOTHING holding them together — and they had drifted in both directions at
    once. The two directions fail differently:

      · an allowlist entry with no field is DEAD PERMISSION. Harmless, because
        `body.dict(exclude_unset=True)` can never produce that key, but it
        reads as a working feature and hides the third case below.
      · a field with no allowlist entry is the DANGEROUS one. The value is
        accepted, silently dropped, and the caller is told 200.

    Both are refused here. Deleting an entry is not the fix for the first case
    — Phase 7.1a settled that on `territory_id`, because deleting makes a
    column settable exactly once at create and unreachable from every client
    for ever. Add the field.
    """
    import inspect
    src = inspect.getsource(graha.update_deal)
    start = src.index("_DEAL_COLS = {")
    allowlist = set(eval(src[src.index("{", start):src.index("}", start) + 1]))
    fields = set(graha.DealUpdate.model_fields)
    assert fields - allowlist == set(), (
        f"{sorted(fields - allowlist)} can be sent, are accepted, and are "
        f"then silently discarded — the route answers 200 and writes nothing")
    assert allowlist - fields == set(), (
        f"{sorted(allowlist - fields)} is permission to write a column no "
        f"request can ask for; give it a field rather than deleting it")


# ── The four paths found by sweeping for the shape ───────────────────────────

@pytest.mark.parametrize("field", ["deal_id", "contact_id"])
async def test_an_activity_cannot_be_filed_on_another_orgs_record(
        field, api_client, mock_pool, as_admin, with_org_id):
    """Here the leak writes rather than reads.

    The note lands in the other tenant's deal drawer, under their contact, in
    their org's UI — an injection into another firm's record, authored by
    somebody with no membership of it.
    """
    scoped_fetchval(mock_pool, allow=())
    resp = await api_client.post("/api/v1/graha/activities", json={
        "title": "Called them", "activity_type": "call", field: FOREIGN})
    assert resp.status_code == 400
    assert find_call(mock_pool, "INSERT INTO public.graha_activities") is None


@pytest.mark.parametrize("field", ["deal_id", "contact_id"])
async def test_a_follow_up_cannot_be_filed_on_another_orgs_record(
        field, api_client, mock_pool, as_admin, with_org_id):
    """The sharpest of the four: a follow-up is EMAILED.

    The reminder job reads these rows and mails the assignee, so an unchecked
    parent id put one firm's text into another firm's record and out through
    their notifications.
    """
    scoped_fetchval(mock_pool, allow=())
    resp = await api_client.post("/api/v1/graha/follow-ups", json={
        "title": "Chase", "due_at": "2026-09-01T10:00:00+00:00", field: FOREIGN})
    assert resp.status_code == 400
    assert find_call(mock_pool, "INSERT INTO public.graha_follow_ups") is None


@pytest.mark.parametrize("field", ["deal_id", "contact_id"])
async def test_a_document_cannot_be_filed_on_another_orgs_record(
        field, api_client, mock_pool, as_admin, with_org_id):
    """And here the thing being planted is a FILE, with a caller-chosen URL."""
    scoped_fetchval(mock_pool, allow=())
    resp = await api_client.post("/api/v1/graha/documents", json={
        "name": "Quote.pdf",
        "file_url": "https://files.kartavaya.com/o/quote.pdf",
        "file_key": "o/quote.pdf",
        field: FOREIGN,
    })
    assert resp.status_code == 400
    assert find_call(mock_pool, "INSERT INTO public.graha_documents") is None


@pytest.mark.parametrize("field", ["deal_id", "contact_id"])
async def test_a_document_cannot_be_RE_filed_onto_another_orgs_record(
        field, api_client, mock_pool, as_admin, with_org_id):
    """Re-filing is the same write as filing, and an easier one.

    The row already exists and is already the caller's; only the parent id has
    to be guessed. Guarding the create and leaving the PATCH open closes the
    front door and leaves the side one.
    """
    scoped_fetchval(mock_pool, allow=())
    resp = await api_client.patch(
        "/api/v1/graha/documents/e0000000-0000-0000-0000-00000000000e",
        json={field: FOREIGN})
    assert resp.status_code == 400
    assert find_call(mock_pool, "UPDATE public.graha_documents") is None


def test_every_deal_resolver_checks_org_AND_is_active():
    """Both halves, on all four resolvers.

    `org_id` is the tenancy half. `is_active` is the other one and it is not
    decoration: DELETE on a contact, a deal and a pipeline are all SOFT — they
    flip the flag and keep the row — so without it a record a firm deliberately
    removed stays attachable for ever and walks back onto the screens under a
    name somebody asked to have taken off.
    """
    import inspect
    for fn in (graha.resolve_contact_company, graha.resolve_contact_territory,
               graha.resolve_deal_contact, graha.resolve_deal_pipeline,
               graha.resolve_deal_id):
        code = " ".join(inspect.getsource(fn).split())
        assert "org_id=$2::uuid" in code, f"{fn.__name__} does not scope by org"
        assert "is_active=TRUE" in code, f"{fn.__name__} accepts a deleted row"
        # Returns "" rather than None for "nothing named" — every caller binds
        # through `NULLIF($n,'')::uuid`, and an untyped NULL through PgBouncer
        # is the parse error that reads as an instant 500.
        assert 'return ""' in code
