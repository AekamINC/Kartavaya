"""#31, #36, #41 — and the three ways a model step downstream turns dangerous.

These handlers call no model. Their whole job is to be the deterministic half a
model step is grounded on, so the tests are about the guarantees that half must
make.

  · `test_it_never_drafts_a_letter` — #31 is the most dangerous output in the
    catalogue and was chipped "near-free". A model-drafted scope paragraph that
    reaches eSign becomes a signed contract nobody wrote. The handler must
    return inputs and BLOCKERS, and must not be capable of returning prose.
  · `test_the_placeholder_inventory_is_exact` — #36's safety is deterministic
    POST-validation. A model that silently renumbers {{1}} and {{2}} produces a
    template Meta approves which then sends the wrong name to the wrong person.
  · `test_the_third_bucket_is_real_rows_not_an_invented_state` — the folio's
    own correction to #41. Measured live: 150 attended, 75 cancelled, 75
    no_show. Nothing is "never marked".
  · `test_an_unrecognised_outcome_is_never_folded_into_a_total` — a status this
    module does not know about is a schema change nobody announced.

Live, read-only 2026-08-20: E2E has 62 engagements, 10 templates (every one
carrying placeholders, all `en`), and 8 ended events with 48 registrations
split across all three buckets with 0 unrecognised outcomes.
"""
import inspect
import json
from datetime import date, datetime, timezone

import pytest

from services.skills.data import content_runs as cr
from services.skills.data.content_runs import (
    ENGAGEMENT_BLOCKERS, FOLLOWUP_BUCKETS, brief_vernacular_template_targets,
    check_event_followup_split, pack_engagement_letter_inputs,
)

ORG = "00000000-0000-4000-8000-000000000031"


class _Pool:
    def __init__(self, by=None):
        self.by = by or {}

    def _pick(self, sql):
        for frag, payload in self.by.items():
            if frag in sql:
                return payload
        return []

    async def fetch(self, sql, *a):
        return self._pick(sql)

    async def fetchrow(self, sql, *a):
        rows = self._pick(sql)
        return rows[0] if rows else None

    async def fetchval(self, sql, *a):
        return None


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(cr, "utc_now",
                        lambda: datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc))


def _text(out) -> str:
    return json.dumps(out, default=str).lower()


# ══════════════════════════════════════════════════════════════════════════
# 31 · the letter that must not be written
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_it_never_drafts_a_letter(frozen):
    """The single most important assertion in this file."""
    pool = _Pool({"ganit_contracts": [], "client_obligations": []})

    out = await pack_engagement_letter_inputs(pool, ORG)

    assert out["can_draft_a_letter"] is False
    assert len(out["blockers"]) == len(ENGAGEMENT_BLOCKERS) == 4
    assert "nobody in the firm wrote" in out["why_not"]
    # And nothing in the output is letter prose.
    assert "dear " not in _text(out)
    assert "we are pleased" not in _text(out)


@pytest.mark.asyncio
async def test_every_blocker_says_what_is_needed(frozen):
    pool = _Pool({"ganit_contracts": [], "client_obligations": []})

    out = await pack_engagement_letter_inputs(pool, ORG)

    keys = {b["blocker"] for b in out["blockers"]}
    assert keys == {"clause_library", "deterministic_assembly",
                    "human_diff", "clause_version_record"}
    for b in out["blockers"]:
        assert b["what_is_needed"].strip()


@pytest.mark.asyncio
async def test_the_msmed_clause_is_a_question_never_a_default(frozen):
    """It applies where THE FIRM is the MSME supplier, and nothing records
    that the firm is one."""
    pool = _Pool({"ganit_contracts": [], "client_obligations": []})

    out = await pack_engagement_letter_inputs(pool, ORG)

    assert out["msmed_clause"]["include"] is None
    assert "never a default" in out["msmed_clause"]["why"]


@pytest.mark.asyncio
async def test_an_empty_register_is_not_every_client_engaged(frozen):
    pool = _Pool({"ganit_contracts": [], "client_obligations": []})

    out = await pack_engagement_letter_inputs(pool, ORG)

    assert out["counts"]["clients_with_obligations_on_record"] == 0
    assert any("nobody has recorded" in l for l in out["limitations"])


def test_the_engagement_join_is_org_scoped():
    """graha_clients and graha_contacts both carry org_id — the FK is on the id
    alone and an id-only join prints another practice's client."""
    src = inspect.getsource(pack_engagement_letter_inputs)
    for line in src.splitlines():
        if "JOIN public.graha_" in line:
            idx = src.index(line)
            assert "org_id" in src[idx:idx + 200], line


# ══════════════════════════════════════════════════════════════════════════
# 36 · the placeholder contract
# ══════════════════════════════════════════════════════════════════════════

def _tpl(**kw):
    row = {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "payment_reminder", "language": "en", "category": "UTILITY",
        "body": "Namaste {{1}}, invoice {{2}} is due on {{3}}.",
        "header_content": None, "footer": None, "status": "APPROVED",
    }
    row.update(kw)
    return row


@pytest.mark.asyncio
async def test_the_placeholder_inventory_is_exact(frozen):
    """A model that silently renumbers {{1}} and {{2}} produces a template Meta
    approves and which then sends the wrong name to the wrong person."""
    pool = _Pool({"varta_templates": [_tpl()]})

    out = await brief_vernacular_template_targets(pool, ORG)

    item = out["templates"][0]
    assert item["placeholders"] == [1, 2, 3]
    assert item["placeholder_count"] == 3
    assert "do not accept the model" in item["verify_after_translation"].lower()


@pytest.mark.asyncio
async def test_placeholders_are_collected_from_every_part(frozen):
    """Header and footer carry them too, and a translation that drops one is
    still a rejected template."""
    pool = _Pool({"varta_templates": [
        _tpl(header_content="{{1}}", body="hello", footer="ref {{2}}")]})

    out = await brief_vernacular_template_targets(pool, ORG)

    assert out["templates"][0]["placeholders"] == [1, 2]


@pytest.mark.asyncio
async def test_no_target_language_is_invented(frozen):
    """Inferring a language from a name or a state would be worse than not
    answering."""
    pool = _Pool({"varta_templates": [_tpl()]})

    out = await brief_vernacular_template_targets(pool, ORG)

    assert out["target_languages"] == []
    assert "worse than not" in out["why_no_targets"]
    assert "NOTHING IN THIS PRODUCT RECORDS" in out["why_no_targets"]


@pytest.mark.asyncio
async def test_the_billing_unit_includes_the_revision(frozen):
    """Meta rejections force revisions, and each is another call. Costing this
    per template understates it by however many times Meta says no."""
    pool = _Pool({"varta_templates": []})

    out = await brief_vernacular_template_targets(pool, ORG)

    assert out["billing_unit"] == "template x language x revision"
    assert "rejected" in out["why_that_unit"]


# ══════════════════════════════════════════════════════════════════════════
# 41 · the split
# ══════════════════════════════════════════════════════════════════════════

def _reg(status, n, title="Webinar", ends="2026-08-01"):
    return {"event_id": "22222222-2222-4222-8222-222222222222", "title": title,
            "ends_at": datetime.fromisoformat(ends).replace(tzinfo=timezone.utc),
            "status": status, "n": n}


@pytest.mark.asyncio
async def test_the_third_bucket_is_real_rows_not_an_invented_state(frozen):
    """The folio's own correction. Live: 150 attended, 75 cancelled, 75 no_show
    — every bucket is a status that exists in the data."""
    pool = _Pool({"prachar_events": [
        _reg("attended", 10), _reg("no_show", 5), _reg("cancelled", 3)]})

    out = await check_event_followup_split(pool, ORG)

    got = {b["outcome"]: b["people"] for b in out["buckets"]}
    assert got == {"attended": 10, "no_show": 5, "cancelled": 3}
    assert {s for s, _, _ in FOLLOWUP_BUCKETS} == {"attended", "no_show", "cancelled"}
    # The ANSWER, without the caveats. `limitations` legitimately contains the
    # phrase — it is the sentence admitting that somebody who came and was
    # never marked attended is invisible — so a whole-body check matches the
    # admission and fails on a correct handler. Third time this trap has bitten
    # in this codebase; `test_ganit_ops._sql_only` records the first.
    answer = _text({k: v for k, v in out.items() if k != "limitations"})
    assert "never marked" not in answer


@pytest.mark.asyncio
async def test_each_bucket_carries_a_different_next_step(frozen):
    """Three buckets driving one message is the thing this replaces."""
    pool = _Pool({"prachar_events": [_reg("attended", 1), _reg("no_show", 1),
                                     _reg("cancelled", 1)]})

    out = await check_event_followup_split(pool, ORG)

    steps = [b["next_step"] for b in out["buckets"]]
    assert len(set(steps)) == 3
    cancelled = [b for b in out["buckets"] if b["outcome"] == "cancelled"][0]
    assert "do not pitch" in cancelled["next_step"]


@pytest.mark.asyncio
async def test_an_unrecognised_outcome_is_never_folded_into_a_total(frozen):
    """A status this module does not know is a schema change nobody announced."""
    pool = _Pool({"prachar_events": [_reg("attended", 4), _reg("waitlisted", 7)]})

    out = await check_event_followup_split(pool, ORG)

    assert out["counts"]["unrecognised_outcomes"] == 7
    assert out["unrecognised_outcomes"] == [{"outcome": "waitlisted", "people": 7}]
    got = {b["outcome"]: b["people"] for b in out["buckets"]}
    assert got["attended"] == 4          # not 11


@pytest.mark.asyncio
async def test_an_event_with_no_end_time_is_skipped_not_assumed_over(frozen):
    pool = _Pool({"prachar_events": []})

    out = await check_event_followup_split(pool, ORG)

    assert out["counts"]["events_ended_in_window"] == 0
    assert any("skipped rather than assumed over" in l for l in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# the module's promises
# ══════════════════════════════════════════════════════════════════════════

SRC = inspect.getsource(cr)


def test_nothing_here_writes_and_nothing_calls_a_model():
    for verb in ("insert into", "update ", "delete from", "generate(",
                 "agent_type", "openai", "gemini"):
        assert verb not in SRC.lower(), verb


def test_no_handler_builds_its_own_clock():
    assert "utcnow()" not in SRC
    assert ").days" not in SRC.replace("days_between", "")


@pytest.mark.parametrize("fn", [pack_engagement_letter_inputs,
                                brief_vernacular_template_targets,
                                check_event_followup_split])
def test_every_handler_runs_from_the_org_alone(fn):
    required = [n for n, p in inspect.signature(fn).parameters.items()
                if n not in ("pool", "org_id") and p.default is inspect.Parameter.empty]
    assert not required, f"{fn.__name__} requires {required}"


@pytest.mark.parametrize("fn", [pack_engagement_letter_inputs,
                                brief_vernacular_template_targets,
                                check_event_followup_split])
@pytest.mark.asyncio
async def test_every_handler_always_returns_limitations(fn, frozen):
    out = await fn(_Pool(), ORG)

    assert out["limitations"]
    assert all(isinstance(l, str) and l.strip() for l in out["limitations"])
    assert out["counts"]


def test_every_query_is_org_scoped():
    import ast
    for node in ast.walk(ast.parse(SRC)):
        if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                and "FROM public." in node.value):
            assert "org_id = $1::uuid" in node.value, node.value[:120]
