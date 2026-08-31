"""A lead-scoring rule can be created, and cannot be created dead.

── THE DEFECT ─────────────────────────────────────────────────────────────────

`compute_lead_score` is a complete engine: fifteen signals across the contact
row, its deals, its activities and its follow-ups, each worth whatever points a
rule assigns. `GET /scoring-rules` listed them and `PATCH /scoring-rules/{id}`
amended them.

There was no POST. A rule could be read and edited and never CREATED, so
`graha_scoring_rules` was empty in every organisation, `compute_lead_score`
returned at its first line — `if not rules: return 0, []` — and every
`lead_score` in the product was 0. No screen offered it either; a grep for
`scoring-rules` across `frontend/src` returned nothing but a comment in
`prachar/AudienceFilter.jsx` recording that the table is empty.

Suite 04.17 found it by looking for the screen, then for the route.

── THE SECOND DEFECT THE FIX HAD TO AVOID CREATING ────────────────────────────

`graha_scoring_rules.signal` is plain `text` with no constraint. A rule naming
a signal the engine does not know would be accepted, stored, listed on the
screen — and never fire. The firm would believe it was scoring on something and
it would not be. That is the dead-control shape, and shipping a create route
without the vocabulary check would have manufactured it.

So the route refuses an unknown signal and names the list, and
`GET /scoring-signals` publishes that list so a picker is built from the
engine's own vocabulary instead of a hardcoded copy.

── WHAT THIS FILE PINS ────────────────────────────────────────────────────────

The refusals, and — the one that outlives every other assertion here — that the
published vocabulary still matches what `compute_lead_score` actually reads. A
signal dropped from the engine and left in the picker fails silently: rules go
on being offered, stored and scored at zero, with nothing anywhere saying so.
"""
import re
import inspect
import pytest

from routers import graha


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.graha import _crm_entity_gate, _gate
    for dep in (_gate, _crm_entity_gate):
        app.dependency_overrides[dep] = lambda: None
    yield
    for dep in (_gate, _crm_entity_gate):
        app.dependency_overrides.pop(dep, None)


@pytest.fixture
def as_org_admin(monkeypatch):
    async def _yes(_user_id, _org_id):
        return True
    monkeypatch.setattr(graha, "is_org_admin", _yes)
    return _yes


@pytest.fixture
def not_org_admin(monkeypatch):
    async def _no(_user_id, _org_id):
        return False
    monkeypatch.setattr(graha, "is_org_admin", _no)
    return _no


class TestTheVocabularyMatchesTheEngine:
    """⚠ THE ASSERTION WORTH THE MOST HERE.

    Everything else in this file checks a refusal. This checks that the list
    the refusal is made from is still the list the engine reads — and that is
    the one that fails SILENTLY if it drifts.
    """

    def test_every_dynamic_signal_named_is_one_the_engine_builds(self):
        src = inspect.getsource(graha.compute_lead_score)
        block = src[src.index("dynamic_signals = {"):]
        block = block[:block.index("}")]
        built = set(re.findall(r'"([a-z0-9_]+)":', block))
        assert built, "the dynamic_signals block could not be read at all"
        declared = set(graha._DYNAMIC_SCORING_SIGNALS)
        assert declared == built, (
            "the published dynamic signals and the ones `compute_lead_score` "
            "actually builds have drifted.\n"
            f"  offered but never built: {sorted(declared - built)}\n"
            f"  built but never offered: {sorted(built - declared)}\n"
            "A rule on a signal the engine does not build is accepted, stored, "
            "listed, and scores nothing for ever."
        )

    def test_the_static_half_comes_from_the_engine_not_a_copy(self):
        assert set(graha.SCORING_SIGNALS) <= graha._SCORING_SIGNAL_VOCABULARY

    def test_every_signal_has_a_sentence_a_person_can_read(self):
        missing = sorted(
            s for s in graha._SCORING_SIGNAL_VOCABULARY
            if s not in graha._SCORING_SIGNAL_LABELS
        )
        assert not missing, (
            f"these signals would be offered to a partner as raw keys: {missing}. "
            "'deal_negotiation' is a developer's word, not a sentence somebody "
            "deciding which leads to chase should have to translate."
        )

    @pytest.mark.anyio
    async def test_the_endpoint_publishes_it(self, api_client, as_admin, with_org_id):
        r = await api_client.get("/api/v1/graha/scoring-signals")
        assert r.status_code == 200
        offered = {row["signal"] for row in r.json()["data"]}
        assert offered == set(graha._SCORING_SIGNAL_VOCABULARY)
        assert all(row["label"] for row in r.json()["data"])


class TestCreatingARule:
    @pytest.mark.anyio
    async def test_a_known_signal_is_stored(
        self, api_client, mock_pool, as_admin, with_org_id, as_org_admin,
    ):
        mock_pool.fetchval.side_effect = [None]          # no duplicate
        mock_pool.fetchrow.return_value = {
            "id": "11111111-1111-1111-1111-111111111111", "signal": "high_value_deal",
            "points": 25, "description": None, "is_active": True,
        }
        r = await api_client.post("/api/v1/graha/scoring-rules",
                                  json={"signal": "high_value_deal", "points": 25})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "created"

    @pytest.mark.anyio
    async def test_an_unknown_signal_is_refused_and_the_list_is_named(
        self, api_client, mock_pool, as_admin, with_org_id, as_org_admin,
    ):
        """⚠ THE REFUSAL THE FIX EXISTS FOR AS MUCH AS THE ROUTE DOES.

        `signal` is plain text with no constraint, so this would otherwise be
        stored, listed, and inert.
        """
        r = await api_client.post("/api/v1/graha/scoring-rules",
                                  json={"signal": "opened_the_email", "points": 10})
        assert r.status_code == 422
        detail = str(r.json()["detail"])
        assert "never fire" in detail
        assert "high_value_deal" in detail, "the refusal does not name the vocabulary"

    @pytest.mark.anyio
    async def test_the_write_never_happened_on_a_refusal(
        self, api_client, mock_pool, as_admin, with_org_id, as_org_admin,
    ):
        await api_client.post("/api/v1/graha/scoring-rules",
                              json={"signal": "opened_the_email", "points": 10})
        sql = " ".join(str(c.args[0]) for c in mock_pool.fetchrow.await_args_list)
        assert "INSERT INTO public.graha_scoring_rules" not in sql

    @pytest.mark.anyio
    @pytest.mark.parametrize("points", [101, -101, 5000])
    async def test_points_outside_the_band_are_refused(
        self, api_client, mock_pool, as_admin, with_org_id, as_org_admin, points,
    ):
        """The total is clamped to 0-100, so one rule worth 5,000 silently
        swallows every other rule the firm set."""
        r = await api_client.post("/api/v1/graha/scoring-rules",
                                  json={"signal": "has_phone", "points": points})
        assert r.status_code == 422
        assert "drown out" in str(r.json()["detail"])

    @pytest.mark.anyio
    @pytest.mark.parametrize("points", [100, -100, 0])
    async def test_the_edges_of_the_band_are_allowed(
        self, api_client, mock_pool, as_admin, with_org_id, as_org_admin, points,
    ):
        mock_pool.fetchval.side_effect = [None]
        mock_pool.fetchrow.return_value = {
            "id": "11111111-1111-1111-1111-111111111111", "signal": "has_phone",
            "points": points, "description": None, "is_active": True,
        }
        r = await api_client.post("/api/v1/graha/scoring-rules",
                                  json={"signal": "has_phone", "points": points})
        assert r.status_code == 200, r.text

    @pytest.mark.anyio
    async def test_a_second_rule_on_one_signal_is_refused(
        self, api_client, mock_pool, as_admin, with_org_id, as_org_admin,
    ):
        """Two rules on one signal both fire and their points ADD, which is
        never what somebody means by setting it twice — they mean to change it."""
        mock_pool.fetchval.side_effect = [1]             # a rule already exists
        r = await api_client.post("/api/v1/graha/scoring-rules",
                                  json={"signal": "has_phone", "points": 5})
        assert r.status_code == 409
        assert "already a rule" in str(r.json()["detail"])

    @pytest.mark.anyio
    async def test_a_plain_member_cannot_set_the_firm_s_policy(
        self, api_client, mock_pool, as_admin, with_org_id, not_org_admin,
    ):
        """Matching PATCH: which leads the firm chases first is a policy, not a
        record."""
        r = await api_client.post("/api/v1/graha/scoring-rules",
                                  json={"signal": "has_phone", "points": 5})
        assert r.status_code == 403
