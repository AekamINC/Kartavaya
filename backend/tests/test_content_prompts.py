"""Prompts that ask for a structure instead of a blob a regex has to guess at.

`routers/hub.py` asks for prose — AGENT_PROMPTS["social_media"] ends "Output the
post text only" — and then recovers the hashtags with `re.findall(r'#\\w+', ...)`
at three separate call sites. The regex keeps the `#`, so
`services/social_publisher.py:690` publishes `##GST` under a paragraph that
already carried the same tags.

The other half is that one prompt covers destinations that disagree at the
syntax level. QUICK_SKILL_PROMPTS["social_post"]["system"] instructs "Use
markdown formatting: **bold** for emphasis" and then, six lines later, "If
LinkedIn, be more professional" — but LinkedIn's post field is plain text and
Instagram's caption renders nothing, so the instruction is wrong for two of the
three networks it names.

These tests hold the replacement to the contract, and hold the contract to the
one mechanical hazard that can take a customer's credit with it.
"""

import string

import pytest

import routers.hub as hub
from services import rich_content as rc
from services.skills import content_prompts as cp


def _placeholders(template: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(template) if name}


# ── 1 · The `.format()` trap ─────────────────────────────────────────────────
#
# Both callers substitute with `str.format()`. `.format()` reads every `{` as a
# placeholder and raises on a name it was not handed — after `spend_standalone`
# has already committed the debit, and `generate_content` only refunds a
# PROVIDER exception. A literal brace in a template is therefore a silent charge
# for nothing.

@pytest.mark.parametrize("agent_type", sorted(cp.AGENT_PROMPTS))
def test_an_agent_template_survives_the_format_call_the_router_makes(agent_type):
    template = cp.AGENT_PROMPTS[agent_type]
    assert _placeholders(template) <= {"platform", "brief", "extra"}
    template.format(platform="p", brief="b", extra="e")


@pytest.mark.parametrize("skill", sorted(cp.QUICK_SKILL_PROMPTS))
def test_a_quick_template_survives_the_format_call_quick_generate_makes(skill):
    template = cp.QUICK_SKILL_PROMPTS[skill]["prompt"]
    assert _placeholders(template) <= {"topic", "platform", "tone", "language", "extra"}
    template.format(topic="t", platform="p", tone="n", language="l", extra="x")


def test_the_json_contract_is_exactly_what_must_never_be_formatted():
    """It is nothing but braces, which is why `build_content_prompt` appends it
    after substitution instead of interpolating it."""
    with pytest.raises((KeyError, ValueError, IndexError)):
        cp.RICH_DOC_CONTRACT.format(brief="x", platform="y", extra="z")


def test_the_built_prompt_carries_the_contract_through_intact():
    out = cp.build_content_prompt("social_media", "GSTR-3B deadline", platform="LinkedIn")
    assert cp.RICH_DOC_CONTRACT in out
    assert "GSTR-3B deadline" in out
    assert "{brief}" not in out and "{platform}" not in out


# ── 2 · A drop-in for what the router holds today ────────────────────────────

def test_every_agent_type_the_router_accepts_is_covered():
    """`generate_content` rejects an agent_type that is not a key before it
    spends anything. A missing key here turns a working request into a 400."""
    assert set(hub.AGENT_PROMPTS) <= set(cp.AGENT_PROMPTS)


def test_every_quick_skill_the_generate_tab_sends_is_covered():
    assert set(hub.QUICK_SKILL_PROMPTS) <= set(cp.QUICK_SKILL_PROMPTS)


@pytest.mark.parametrize("skill", sorted(hub.QUICK_SKILL_PROMPTS))
def test_a_quick_skill_still_charges_under_the_same_price_key(skill):
    """`quick_generate` spends with `ref_id=skill_cfg["agent_type"]`, so that
    string IS the price lookup. Changing it silently re-prices the skill."""
    assert cp.QUICK_SKILL_PROMPTS[skill]["agent_type"] == hub.QUICK_SKILL_PROMPTS[skill]["agent_type"]


# ── 3 · The structure is asked for, not guessed at ───────────────────────────

@pytest.mark.parametrize("agent_type", sorted(cp.AGENT_PROMPTS))
def test_every_agent_prompt_reaches_the_named_fields(agent_type):
    """Not decoration: the fields are what stops `re.findall(r'#\\w+')` from
    being the thing that decides what a hashtag is."""
    out = cp.build_content_prompt(agent_type, "brief").lower()
    for field in ("headline", "body", "bullets", "call_to_action", "hashtags"):
        assert field in out


def test_the_contract_forbids_hashtags_inside_the_prose():
    assert "NO hashtags inside headline" in cp.RICH_DOC_CONTRACT
    assert "without the # symbol" in cp.RICH_DOC_CONTRACT


def test_the_contract_names_the_four_transport_markers_and_no_others():
    assert "**bold**" in cp.RICH_DOC_CONTRACT
    assert "*italic*" in cp.RICH_DOC_CONTRACT
    assert "~~strikethrough~~" in cp.RICH_DOC_CONTRACT
    assert "`monospace`" in cp.RICH_DOC_CONTRACT
    assert "do not write HTML" in cp.RICH_DOC_CONTRACT


@pytest.mark.parametrize("skill", sorted(cp.QUICK_SKILL_PROMPTS))
def test_no_prompt_tells_the_model_to_output_markdown(skill):
    """The instruction that produced the asterisks on LinkedIn. The model is
    told what to SAY; `rich_content` decides what the syntax is."""
    cfg = cp.QUICK_SKILL_PROMPTS[skill]
    for text in (cfg["system"], cfg["prompt"]):
        lowered = text.lower()
        assert "markdown" not in lowered
        assert "## " not in text
        assert "**" not in text


def test_the_destination_brief_states_budgets_and_never_a_syntax():
    """A model told "LinkedIn has no markdown" starts hand-rolling Unicode bold
    into the JSON, which is the accessibility problem arriving through the front
    door instead of being confined to one mapper."""
    brief = cp.destination_brief(["linkedin", "instagram", "whatsapp_business"])
    assert "2200" in brief and "Instagram" in brief
    for leaked in ("markdown", "unicode", "asterisk", "**", "<strong>", "```"):
        assert leaked not in brief.lower()


def test_the_destination_brief_says_so_when_a_surface_has_no_hashtags():
    assert "empty hashtags array" in cp.destination_brief(["whatsapp_business"])
    assert "empty hashtags array" not in cp.destination_brief(["instagram"])


def test_the_brief_for_a_tweet_names_x_rather_than_the_in_app_editor():
    """"Twitter / X" is what the Generate form sends. Unresolved it fell to the
    in-app editor, and the model was briefed for a surface with no budget and
    no hashtags — for the one platform whose 280 characters matter most."""
    brief = cp.destination_brief(["Twitter / X"])
    assert "published to: X." in brief
    assert "280" in brief
    assert "empty hashtags array" not in brief


def test_google_ads_is_briefed_on_its_per_field_caps():
    """The Ads editor caps each field rather than the piece, so the destination
    carries no `limit` and `_limit_note` has nothing to say. The numbers the
    model has to write to therefore have to come from somewhere else."""
    brief = cp.destination_brief(["Google Ads"])
    assert "Google Ads" in brief
    assert "30" in brief and "90" in brief


# ── 4 · Register: the prompt and the enforcement are one source ──────────────

@pytest.mark.parametrize("skill", sorted(cp.QUICK_SKILL_PROMPTS))
def test_the_register_a_skill_is_briefed_on_is_the_register_that_is_enforced(skill):
    """"Include relevant emojis naturally" is applied by the current file to a
    WhatsApp broadcast and to a business proposal alike. The brief and the
    ceiling now come from the same `EmojiPolicy`, so they cannot describe
    different rules."""
    cfg = cp.QUICK_SKILL_PROMPTS[skill]
    policy = rc.policy_for(skill, cfg.get("register"))
    assert policy.name == cfg["register"]
    assert policy.brief in cp.register_brief(skill, cfg.get("register"))


def test_a_statutory_notice_is_briefed_for_no_emoji_at_all():
    assert rc.policy_for("compliance_alert").max_total == 0
    assert "NO emoji" in cp.register_brief("compliance_alert")


def test_a_festival_campaign_is_briefed_for_warmth():
    assert rc.policy_for("festival_campaign").max_total >= 8
    assert cp.register_for_skill("festival_campaign") == "festive"


def test_turning_emoji_off_overrides_the_festive_register_in_the_prompt_too():
    """The renderer honours `emoji=False` absolutely; the prompt has to say the
    same thing, or the model writes emoji that are then stripped and the piece
    reads as though words are missing."""
    assert "NO emoji" in cp.register_brief("festival_campaign", emoji=False)


def test_a_skill_without_a_declared_register_still_gets_a_considered_one():
    assert cp.register_for_skill("blog_post") == "professional"
    assert cp.register_for_skill("not_a_skill") == rc.DEFAULT_REGISTER


# ── 5 · System suffix ────────────────────────────────────────────────────────

def test_the_system_suffix_carries_register_destinations_and_contract():
    out = cp.system_suffix(
        content_type="social_post", register="conversational",
        destinations=["linkedin"], language="hi", language_name="Hindi",
    )
    assert "EMOJI:" in out
    assert "LinkedIn" in out
    assert "Hindi" in out
    assert cp.RICH_DOC_CONTRACT in out


def test_english_gets_no_translation_instruction():
    out = cp.system_suffix(content_type="blog", language="en")
    assert "compose in it" not in out


def test_build_quick_prompt_refuses_a_skill_that_does_not_exist():
    """`quick_generate` validates the skill name and 400s before it charges.
    A silent fallback here would generate the wrong thing at full price."""
    with pytest.raises(KeyError):
        cp.build_quick_prompt("no_such_skill", topic="x")


def test_build_quick_prompt_splits_the_standing_rules_from_the_request():
    system, prompt = cp.build_quick_prompt(
        "compliance_alert", topic="GSTR-3B July", platform="whatsapp_business",
    )
    assert "NO emoji" in system
    assert "GSTR-3B July" in prompt
    assert "GSTR-3B July" not in system, \
        "the topic in the system half is read as an instruction, not as a subject"


def test_the_prompts_module_makes_no_model_call():
    import inspect
    source = inspect.getsource(cp)
    for forbidden in ("httpx", "generate(", "API_KEY", "await "):
        assert forbidden not in source
