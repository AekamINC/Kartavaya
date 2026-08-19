"""Every model the router can reach has a price, and nothing quietly logs $0.

WHAT WAS MEASURED, 2026-08-19
-----------------------------
`MODEL_PRICING` is matched as a SUBSTRING of the model id, and five of the ids
`staging.hub_ai_providers` actually serves matched no key at all — so
`_estimate_cost` returned 0.0 and every call priced through it was written to
`hub_ai_logs` at $0.0000. Two of the five are the chat chain's paid fallbacks
and one is the premium model:

    thudm/glm-4.5-air:free   the key said `glm-4-air`; a version bump broke it
    qwen/qwen3.6-flash       the key said `qwen/qwen3-30b-a3b`
    qwen/qwen3.6-plus        the key said `qwen/qwen-plus`
    google/gemini-2.5-flash  the key said `…-flash-preview`, which is LONGER
    google/gemini-2.5-pro    the key said `…-pro-preview`, same shape

None of it is visible from a spend report, because a model with no price and a
model that is free produce the identical row. The only reason the damage was
bounded is that OpenRouter reports `usage.cost` in its response and
`_call_openai_compat` prefers it — so the estimate is reached only when a
provider does NOT report cost (Groq, every streamed call whose usage frame goes
missing) and on every path that has to price a call after the fact.

WHY THE RATCHET MATTERS MORE THAN THE NUMBERS
---------------------------------------------
Prices move. What must not move is the property that a reachable id without an
entry FAILS THE BUILD instead of shipping as $0.00 — this table has been wrong
twice for the same reason, and both times the fix was a number rather than a
gate. So the number tests below are few and the structural ones are the point.

`default_model` lives in the database, which a unit test cannot read, so the
reachable set is declared in `ai_router.REACHABLE_MODELS` and checked from two
sides: every id in it must be priced, and every provider code any chain names
must be in it. The remaining gap — somebody editing `default_model` in the
database — is caught at runtime instead, by the warning `_estimate_cost` now
logs, which the last test here pins.
"""
from __future__ import annotations

import logging

import pytest

from services import ai_router
from services.ai_router import (
    GEMINI_GROUNDING_MODEL, GEMINI_TEXT_MODEL, MODEL_PRICING, REACHABLE_MODELS,
    _estimate_cost, _select_providers, INDIC_LANGS, PREMIUM_AGENTS, QUALITY_AGENTS,
)


def priced(model: str) -> bool:
    """Does any MODEL_PRICING key match this id, the way `_estimate_cost` matches."""
    return any(key in model.lower() for key in MODEL_PRICING)


#: Every id the text path can name. The provider table's `default_model` values,
#: plus the two constants `_call_gemini` is pinned to.
ALL_REACHABLE = sorted(set(REACHABLE_MODELS) | {GEMINI_TEXT_MODEL, GEMINI_GROUNDING_MODEL})


# ══════════════════════════════════════════════════════════════════════════
# the ratchet
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("model", ALL_REACHABLE)
def test_every_reachable_model_has_a_price_entry(model):
    """THE GATE. A model with no entry is a call invoiced in dollars and logged
    in zeroes, and no report downstream can tell that from a free model."""
    assert priced(model), (
        f"{model!r} is served by a provider the router chains name, and no "
        f"MODEL_PRICING key matches it — every call to it logs $0.0000. Add its "
        f"published per-token price, with the source and the date."
    )


def test_every_provider_a_chain_names_has_a_declared_model():
    """The other direction: a chain cannot reach a model this file never sees.

    Without it the parametrisation above is only as complete as whoever last
    edited `REACHABLE_MODELS` remembered to be, and adding a provider to a chain
    is exactly the edit that forgets.
    """
    declared = set(REACHABLE_MODELS.values())
    named: set[str] = set()
    for lang in ["en", *sorted(INDIC_LANGS)]:
        for task in ["content", "chatbot"]:
            for agent in ["social_media", "chatbot",
                          *sorted(QUALITY_AGENTS), *sorted(PREMIUM_AGENTS)]:
                named.update(_select_providers(language=lang, agent_type=agent, task=task))

    missing = named - declared
    assert not missing, (
        f"{sorted(missing)} answer questions and are not in REACHABLE_MODELS, so "
        f"nothing checks that their models are priced.")


def test_the_ratchet_is_not_vacuous():
    """Proof the gate would notice, run against an id that is deliberately
    absent. An assertion that finds nothing looks identical whether it is
    enforcing something or broken."""
    assert not priced("acme/never-heard-of-it-v9")
    assert _estimate_cost("acme/never-heard-of-it-v9", 1_000_000, 1_000_000) == 0.0


# ══════════════════════════════════════════════════════════════════════════
# the numbers, and the matching rule that carries them
# ══════════════════════════════════════════════════════════════════════════

def test_the_paid_models_are_not_priced_at_zero():
    """Four of the five ids added on 2026-08-19 are billed. A zero here would
    satisfy the gate above and still understate every report — which is the
    exact failure being fixed, wearing a price."""
    for model in ("qwen/qwen3.6-flash", "qwen/qwen3.6-plus",
                  "google/gemini-2.5-flash", "google/gemini-2.5-pro"):
        assert _estimate_cost(model, 1_000_000, 1_000_000) > 0, model


def test_the_two_gemini_prices_are_googles_published_ones():
    """The check that makes the method trustworthy for the Qwen ids.

    All four rates were recovered by fitting `hub_ai_logs.cost_usd` — OpenRouter's
    own reported charge — against the token counts on the same rows. Two of the
    four have a published list price to compare against, and they land on it
    exactly: $0.30/M in and $2.50/M out for 2.5 Flash, $1.25/M and $10.00/M for
    2.5 Pro (ai.google.dev/pricing, read 2026-08-19).
    """
    assert _estimate_cost("google/gemini-2.5-flash", 1_000_000, 0) == pytest.approx(0.30)
    assert _estimate_cost("google/gemini-2.5-flash", 0, 1_000_000) == pytest.approx(2.50)
    assert _estimate_cost("google/gemini-2.5-pro", 1_000_000, 0) == pytest.approx(1.25)
    assert _estimate_cost("google/gemini-2.5-pro", 0, 1_000_000) == pytest.approx(10.00)


def test_the_new_short_keys_do_not_steal_the_preview_prices():
    """`google/gemini-2.5-flash` is a substring of
    `google/gemini-2.5-flash-lite-preview`, and Lite is the cheaper model.

    `_estimate_cost` takes the LONGEST matching key precisely so the table stays
    order-independent, and adding a shorter key is the edit that would break it —
    silently, by overcharging the report for every Lite call.
    """
    lite = _estimate_cost("google/gemini-2.5-flash-lite-preview", 1_000_000, 1_000_000)
    flash = _estimate_cost("google/gemini-2.5-flash", 1_000_000, 1_000_000)
    assert lite < flash, "the Lite model is now priced as full Flash"

    # The preview endpoint bills at its own rate — $2.50/M in against the
    # released model's $1.25/M — so this is not a cosmetic distinction.
    pro_preview = _estimate_cost("google/gemini-2.5-pro-preview", 1_000_000, 0)
    assert pro_preview == pytest.approx(2.50), "the preview key stopped winning"
    assert pro_preview != _estimate_cost("google/gemini-2.5-pro", 1_000_000, 0)


def test_no_price_is_keyed_on_a_latest_alias():
    """`gemini-flash-latest` resolved to a newer, dearer model the moment Google
    promoted it and billed for a model nobody chose. An alias in this table
    would be the same standing instruction, wearing a price."""
    for key in MODEL_PRICING:
        assert "latest" not in key, f"{key!r} is an alias, not a version"
    for model in ALL_REACHABLE:
        assert "latest" not in model, f"{model!r} is an alias, not a version"


# ══════════════════════════════════════════════════════════════════════════
# the runtime half — the database can still hand us an id nothing knows
# ══════════════════════════════════════════════════════════════════════════

def test_an_unpriced_model_says_so_at_the_time_of_the_call(caplog):
    """`default_model` is a database column, so no test can be the last line of
    defence. When the estimate falls through, the log names the model — instead
    of the omission first appearing as a $0.00 row in somebody's spend report a
    month later."""
    with caplog.at_level(logging.WARNING, logger="services.ai_router"):
        _estimate_cost("acme/never-heard-of-it-v9", 100, 100)
    # `getMessage()`, not `.message` — the record is formatted lazily and the
    # model id only exists in `args` until something asks for the sentence.
    assert any("acme/never-heard-of-it-v9" in r.getMessage() for r in caplog.records), \
        caplog.text


def test_a_priced_model_is_silent(caplog):
    """Otherwise the warning above is noise on every call and gets filtered out,
    which is the same as not having it."""
    with caplog.at_level(logging.WARNING, logger="services.ai_router"):
        _estimate_cost(GEMINI_TEXT_MODEL, 100, 100)
    assert not [r for r in caplog.records if "MODEL_PRICING" in str(r.msg)]


def test_the_pricing_table_is_flat_floats():
    """`_estimate_cost` multiplies these straight into a DECIMAL(10,6) column.
    A string or a None here is a 500 on the first call to that model, and the
    table is edited by hand."""
    for key, prices in MODEL_PRICING.items():
        assert set(prices) == {"prompt", "completion"}, key
        assert all(isinstance(v, float) and v >= 0 for v in prices.values()), key
    assert ai_router.MODEL_PRICING is MODEL_PRICING
