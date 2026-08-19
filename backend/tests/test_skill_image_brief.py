"""The art direction between a skill and the image model.

Owner, 2026-08-19: "better image creation quality less AI slop and detailed
image by description of skill", and "build all skills to have this".

Measured that morning: every picture in the product was asked for with
`"Create a professional image for: " + prompt[:200]`, and the three routes that
reach `generate_image` each handed it an adjective stack — "modern,
scroll-stopping, brand-quality", "bold, eye-catching, professional" — built
from a topic already cut at 200 characters. So the description the owner asked
to be drawn was discarded from its second sentence onward, and no subject,
framing, light, palette or negative ever reached the model at all.

The price tier was not the fault. The lite image model is $0.036 a call and the
premium one $0.040 — the same money — and images are 79% of every rupee this
product has spent on AI. A cheap model given a real composition beats an
expensive one given none, so these tests are about the BRIEF: that the
description arrives whole, that nineteen catalogue skills are nineteen
different pictures, that a skill added tomorrow still gets one, and that the
expansion call falls back to a structured brief rather than to the old string.

`tests/test_image_brief.py` is the other half — the ladder, the fetch and the
preset the router applies AFTER this module hands it a prompt.

Offline. `build_brief` skips its expansion outright unless an OpenRouter or Groq
key is set, and the tests that do exercise it patch `ai_router.generate` and
assert on what it was handed.

── EVERY ASSERTION HERE RUNS AT THE REAL BUDGET ─────────────────────────────

The first version of this file composed with `budget=None` — a shape production
never produces — and certified a prompt no customer has ever received. Measured
2026-08-19: at the router's real limit of 700 characters the `Avoid:` line was
absent from 140 of 140 combinations, and with it the deity ban, the locale note
and the org's own brand colours. All 293 tests were green and not one of those
strings had ever reached a model.

So `_compose` takes the router's budget by default and `_untrimmed` is the
explicit opt-out, used only where the subject IS the untrimmed shape. Anything
that claims something reaches the MODEL goes through `_delivered`, which is the
composed prompt after `generate_image` has sliced and wrapped it.
"""
import ast
import inspect

import pytest

from services import image_brief as ib
import routers.hub as hub


# The nineteen rows in `staging.hub_skill_templates`, read read-only on
# 2026-08-19. Pinned rather than fetched: the offline suite has no database, and
# a row added tomorrow must fall back by CATEGORY rather than fail this file —
# which `test_a_template_added_tomorrow_still_gets_a_direction` is the proof of.
CATALOGUE = {
    "SEO Blog Series": "branding",
    "New lead triage": "engagement",
    "Overdue follow-up chase": "engagement",
    "Weekly Reel Scripts": "engagement",
    "Weekly Social Media Pack": "engagement",
    "Festival Calendar": "festival",
    "Account brief": "general",
    "GSTR-1 filing readiness": "general",
    "GSTR-3B liability brief": "general",
    "Monday Morning Brief": "general",
    "My desk today": "general",
    "Payables payment run": "general",
    "Payroll variance review": "general",
    "Pipeline risk review": "general",
    "Pre-run payroll readiness": "general",
    "Receivables chase pack": "general",
    "Weekly project status brief": "general",
    "Campaign Launch": "launch",
    "Product Launch Pack": "launch",
}

#: Every labelled line the composer can emit, in priority order.
STRUCTURE_LABELS = (
    "Subject:", "Composition:", "Avoid:", "Colour:", "Lighting:", "Setting:",
    "Mood:",
)

#: And the five that survive the router's real budget on every one of the 35
#: authored directions, measured. `Setting:` and `Mood:` are the two the budget
#: is allowed to take — 700 characters cannot hold a real brief and seven lines,
#: and those are the two whose loss changes the picture least.
SURVIVING_LABELS = ("Subject:", "Composition:", "Avoid:", "Colour:", "Lighting:")


def _direction(kw: dict):
    key, direction = ib.art_direction_for(**{
        k: kw.pop(k) for k in
        ("template_name", "skill", "agent_type", "category") if k in kw
    })
    return key, direction


def _compose(**kw):
    """The deterministic half, AT THE BUDGET THE ROUTER WILL ACTUALLY FORWARD.

    `budget` is left at its `-1` default on purpose: it means "ask the router",
    which is what every call site gets. See the module docstring for what the
    old `budget=None` default certified.
    """
    key, direction = _direction(kw)
    return ib.compose_brief(direction=direction, art_key=key, **kw)


def _untrimmed(**kw):
    """The composed shape with nothing dropped.

    For the tests whose subject IS the full shape. Nothing that claims a string
    reaches a model may use this — production never composes this way.
    """
    key, direction = _direction(kw)
    return ib.compose_brief(direction=direction, art_key=key, budget=None, **kw)


def _delivered(**kw) -> str:
    """What the image model is handed, end to end.

    The composed prompt after `generate_image` has cut it at `_SUBJECT_LIMIT`
    and wrapped it in the preset's lettering rule, quality spine and avoid list.
    The only string in this file that is a claim about a MODEL rather than about
    this module.
    """
    import services.ai_router as ar

    out = _compose(**kw)
    _name, preset = ar._resolve_preset(out.style)
    return ar._build_image_prompt(out.prompt, preset)


# ══════════════════════════════════════════════════════════════════════════
# 1 · THE BRIEF IS NOT TRUNCATED
# ══════════════════════════════════════════════════════════════════════════

LONG_BRIEF = (
    "Diwali greeting for our clients across Ahmedabad, Surat and Rajkot, "
    "mentioning that the office is closed from the 8th to the 10th of "
    "November and that emergency support runs on the WhatsApp number. "
    "Thank the eleven firms who came to the annual day in July."
)


def test_a_long_brief_survives_past_two_hundred_characters():
    """The defect, stated as a test. `prompt[:200]` threw away the description
    the owner asked to be drawn."""
    assert len(LONG_BRIEF) > 200
    out = _compose(brief=LONG_BRIEF, template_name="Festival Calendar")
    assert LONG_BRIEF in out.prompt, "the brief was cut — this is the original bug"


def test_the_brief_still_beats_two_hundred_characters_under_the_router_budget():
    """Section 8 explains the budget. It exists because the encoder window is
    real; it is never allowed back down to the old cut."""
    out = _compose(brief=LONG_BRIEF, template_name="Festival Calendar", budget=700)
    assert LONG_BRIEF in out.prompt


def test_the_brief_keeps_its_floor_however_hungry_the_art_direction_is():
    """The art direction is bounded and the brief is not, so the reservation has
    to run the other way: the direction takes what it needs and the brief takes
    the rest, but never less than the floor. A 55/45 ratio gave the brief 385 of
    700 and left ~215 for six lines that need ~600."""
    huge = "sentence. " * 200
    for name in CATALOGUE:
        out = _compose(brief=huge, template_name=name)
        carried = out.prompt.split(", about: ", 1)[1].split("\n")[0]
        assert len(carried) >= ib._BRIEF_FLOOR - 20, (
            f"{name}: the brief was squeezed to {len(carried)} characters"
        )


def test_condense_never_cuts_a_word_in_half():
    brief = " ".join(["surveyors"] * 400)          # far past any budget
    out = ib.condense(brief, budget=120)
    assert len(out) <= 120
    for word in out.rstrip("…").split():
        assert word == "surveyors", "cut mid-word"


def test_condense_prefers_dropping_whole_sentences():
    brief = "First sentence here. Second sentence here. Third sentence here."
    out = ib.condense(brief, budget=45)
    assert out == "First sentence here. Second sentence here."
    assert "…" not in out


def test_a_short_brief_is_returned_untouched():
    assert ib.condense("GST filing reminder") == "GST filing reminder"


@pytest.mark.parametrize(
    "fn", [hub.quick_generate, hub.generate_org_content, hub.run_org_skill],
    ids=lambda f: f.__name__,
)
def test_no_call_site_slices_the_brief_on_its_way_in(fn):
    """Structural, because a string search would be satisfied by the comment
    explaining the history. The bug was a slice literal, so this looks for a
    slice literal — on the value handed to the builder."""
    tree = ast.parse(inspect.getsource(fn).lstrip())
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
             and n.func.id == "build_image_brief"]
    assert calls, f"{fn.__name__} no longer builds an image brief"
    for call in calls:
        briefs = [kw.value for kw in call.keywords if kw.arg == "brief"]
        assert briefs, f"{fn.__name__} builds a brief out of nothing"
        for node in briefs:
            assert not any(isinstance(x, ast.Subscript) for x in ast.walk(node)), (
                f"{fn.__name__} slices the brief before briefing the picture"
            )


# ══════════════════════════════════════════════════════════════════════════
# 2 · EVERY SKILL HAS ITS OWN PICTURE
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("name", sorted(CATALOGUE), ids=ib.slug)
def test_every_catalogue_skill_has_a_hand_written_direction(name):
    key, direction = ib.art_direction_for(template_name=name)
    assert key == ib.slug(name), (
        f"{name!r} fell back to {key!r}. The owner asked for all skills to have "
        f"this; a catalogue row may not reach the category default."
    )
    assert direction is not ib.DEFAULT_ART


def test_a_festival_a_gst_deadline_and_a_launch_are_three_different_pictures():
    """The owner's own example, and the reason this is nineteen entries rather
    than one shared prompt."""
    keys = ["Festival Calendar", "GSTR-3B liability brief", "Product Launch Pack"]
    briefs = [_compose(brief="x", template_name=k) for k in keys]
    subjects = {b.prompt.split("Subject: ")[1].split("\n")[0] for b in briefs}
    palettes = {b.prompt.split("Colour: ")[1].split("\n")[0] for b in briefs}
    assert len(subjects) == 3
    assert len(palettes) == 3


def test_no_two_catalogue_skills_share_a_subject():
    """Nineteen entries that quietly resolved to one sentence would pass the
    test above and still be a single look."""
    subjects = [
        _compose(brief="x", template_name=n).prompt.split("Subject: ")[1]
        for n in CATALOGUE
    ]
    duplicates = {s for s in subjects if subjects.count(s) > 1}
    assert not duplicates, f"skills sharing one subject: {duplicates}"


def test_a_template_added_tomorrow_still_gets_a_direction():
    """The floor. Falling back to NOTHING is the failure being fixed; falling
    back by category is the design."""
    key, direction = ib.art_direction_for(
        template_name="Advance tax instalment brief", category="general",
    )
    assert key == "category:general"
    assert direction is not ib.DEFAULT_ART
    out = _compose(brief="Q2 advance tax",
                   template_name="Advance tax instalment brief", category="general")
    for label in SURVIVING_LABELS:
        assert label in out.prompt


def test_a_template_with_an_unknown_category_still_gets_a_direction():
    key, _ = ib.art_direction_for(template_name="Whatever", category="martian")
    assert key == "default"
    out = _compose(brief="anything", template_name="Whatever", category="martian")
    for label in SURVIVING_LABELS:
        assert label in out.prompt


def test_both_vocabularies_resolve_to_a_real_direction():
    """`/org/quick-generate` knows a skill key and `/org/generate` knows an
    agent type. Both name a kind of picture and neither may land on the
    default."""
    for skill in hub.QUICK_SKILL_PROMPTS:
        _, direction = ib.art_direction_for(skill=skill)
        assert direction is not ib.DEFAULT_ART, f"quick skill {skill!r} has no art"
    for agent_type in hub.AGENT_PROMPTS:
        _, direction = ib.art_direction_for(agent_type=agent_type)
        assert direction is not ib.DEFAULT_ART, f"agent type {agent_type!r} has no art"


# ══════════════════════════════════════════════════════════════════════════
# 3 · STRUCTURE BEATS ADJECTIVES — the slop ratchet
# ══════════════════════════════════════════════════════════════════════════

def _built_prompts():
    for name, category in CATALOGUE.items():
        yield name, _compose(brief="quarterly review", template_name=name,
                             category=category).prompt
    for skill in hub.QUICK_SKILL_PROMPTS:
        yield skill, _compose(brief="quarterly review", skill=skill).prompt
    for agent_type in hub.AGENT_PROMPTS:
        yield agent_type, _compose(brief="quarterly review",
                                   agent_type=agent_type).prompt


ALL_PROMPTS = list(_built_prompts())


@pytest.mark.parametrize("label,prompt", ALL_PROMPTS, ids=lambda v: v[:38])
def test_no_built_prompt_uses_slop_vocabulary(label, prompt):
    """"Professional, high quality, 4k, trending" names nothing a camera could
    do differently, so a diffusion model answers it with the average of its
    training set — which is the look being complained about."""
    hits = ib._SLOP_RE.findall(prompt)
    assert not hits, f"{label}: slop vocabulary reached the model: {sorted(set(hits))}"


def test_the_slop_ratchet_can_actually_fail():
    """A guard is worth its runtime only if it can fire. Prove it."""
    with pytest.raises(AssertionError):
        test_no_built_prompt_uses_slop_vocabulary(
            "decoy", "A professional, high quality 4k image, trending.",
        )


@pytest.mark.parametrize("label,prompt", ALL_PROMPTS, ids=lambda v: v[:38])
def test_every_prompt_carries_the_structure_that_survives_the_budget(label, prompt):
    """Five labels, not seven, and the difference is the point. 700 characters
    cannot hold a real brief and every line, so the contract is which five come
    through — measured across all 35 authored directions — rather than a list
    that is only true when nothing is trimmed."""
    for want in SURVIVING_LABELS:
        assert want in prompt, f"{label} is missing {want}"


@pytest.mark.parametrize("label,kw", [
    (name, {"template_name": name, "category": cat}) for name, cat in CATALOGUE.items()
] + [
    (skill, {"skill": skill}) for skill in hub.QUICK_SKILL_PROMPTS
] + [
    (agent, {"agent_type": agent}) for agent in hub.AGENT_PROMPTS
], ids=lambda v: v if isinstance(v, str) else "")
def test_every_prompt_bans_lettering_by_the_time_the_model_sees_it(label, kw):
    """Diffusion models render text as convincing gibberish. A festival greeting
    with a garbled blessing across it is worse than no picture, so the copy is
    set over the image afterwards and the composition leaves room for it.

    Asserted on the DELIVERED string. The ban is stated twice on this path — the
    composed `Avoid:` line and the router's own lettering rule — and only the
    second one is guaranteed to survive a long brief, so testing the composed
    half alone would pass while the model was told nothing."""
    delivered = _delivered(brief="quarterly review", **kw)
    assert "lettering" in delivered
    assert "no letters, words or numerals" in delivered \
        or "no text, lettering, captions" in delivered


def test_the_locale_is_stated_rather_than_assumed():
    """In the LEAD, so no budget can take it. It was a trailing optional line
    and measured absent for every brief over sixty characters — on directions
    resolving to `blog_hero` and `product_shot`, whose presets carry no India
    cue of any kind."""
    for brief in ("office reopening", "q" * 650):
        out = _compose(brief=brief, template_name="Monday Morning Brief")
        assert "contemporary India" in out.prompt


def test_the_festival_look_depicts_no_deity_at_any_brief_length():
    """It is the customer's own faith. A diffusion model's guess at a face is a
    risk with no upside, so the motifs, the light and the materials carry it.

    At every brief length, because the router restates this nowhere — its own
    festival avoid says "no deity depicted inaccurately", which permits the
    drawing. When this line was appended last it was dropped in 140 of 140
    measured combinations and the only surviving instruction about deities was
    the router's permissive one."""
    for n in (0, 80, 200, 385, 650):
        out = _compose(brief="q" * n, template_name="Festival Calendar")
        assert "depictions of any deity" in out.prompt, f"lost at brief length {n}"
        assert "depictions of any deity" in _delivered(
            brief="q" * n, template_name="Festival Calendar")


def test_the_deity_ratchet_can_actually_fail():
    """A guard is worth its runtime only if it can fire, and this one is the
    reason the whole budget was re-ordered. Composed the old way — the avoid
    line last, after the locale — the ban is absent at every brief length."""
    direction = ib.art_direction_for(template_name="Festival Calendar")[1]
    old_shape = "\n".join([
        "A rich still-life photograph, for an Indian business, about: x",
        f"Subject: {direction.subject}.",
        f"Composition: {direction.composition}.",
        f"Colour: {direction.palette}.",
        f"Lighting: {direction.lighting}.",
        f"Setting: {direction.setting}.",
        f"Mood: {direction.register}.",
        ib.LOCALE_NOTE,
    ])
    assert len(old_shape) < 700, "the old order fitted, and still lost the ban"
    assert "depictions of any deity" not in old_shape


def test_the_slop_signature_survives_where_the_router_does_not_restate_it():
    """"Stock-photo clichés" and "glowing blue circuitry" are the two the module
    names as the look being complained about, and `ai_router._GLOBAL_AVOID`
    contains neither. A short brief is the case they have to survive."""
    out = _compose(brief="quarterly review", agent_type="social_media")
    assert "stock-photo clichés" in out.prompt


# ══════════════════════════════════════════════════════════════════════════
# 4 · BRAND AND PER-ORG OVERRIDES
# ══════════════════════════════════════════════════════════════════════════

def test_brand_colours_reach_the_picture_and_the_logo_does_not():
    """A model asked to reproduce a logo produces a forgery of it. Space is
    reserved instead, and the real file goes over the top.

    At the real budget. The brand lines used to sit after the house palette and
    ahead of the light, and measured with a 385-character brief only Subject and
    Composition survived — the org's own colours were dropped while the house
    palette they were meant to replace stayed."""
    brand = {
        "color_primary": "#0B3D2E", "color_secondary": "#E4B363",
        "logo_dark_url": "https://example.invalid/logo.png",
        "content_donts": "never show competitor packaging",
    }
    out = _compose(brief="anniversary", agent_type="social_media", brand=brand)
    assert "#0B3D2E" in out.prompt and "#E4B363" in out.prompt
    assert "never show competitor packaging" in out.prompt
    assert "logo.png" not in out.prompt
    assert "clear uncluttered corner" in out.prompt


def test_the_brand_palette_replaces_the_house_one_rather_than_arguing_with_it():
    """Two palettes on one prompt is a contradiction the encoder averages, and
    two palettes where the budget may drop either is a coin toss between the
    org's colours and a set it never chose. One slot means neither."""
    _, house = ib.art_direction_for(agent_type="social_media")
    out = _compose(brief="anniversary", agent_type="social_media",
                   brand={"color_primary": "#0B3D2E"})
    assert "#0B3D2E" in out.prompt
    assert house.palette not in out.prompt
    assert out.prompt.count("Colour:") == 1


def test_an_org_override_replaces_a_slot_and_adds_to_the_avoid_list():
    """The shape a future admin screen edits: one key per line of the brief,
    read out of the `hub_org_skills.custom_config` jsonb that already exists."""
    _, house = ib.art_direction_for(template_name="Campaign Launch")
    patched = ib.apply_overrides(house, {
        "palette": "monochrome charcoal on bone white",
        "avoid": ["seasonal props"],
    })
    assert patched.palette == "monochrome charcoal on bone white"
    assert patched.subject == house.subject
    assert "seasonal props" in patched.avoid
    for banned in house.avoid:
        assert banned in patched.avoid, "an override erased a house ban"


def test_the_override_keys_are_the_dataclass_fields():
    """So the admin form is one input per slot with no mapping layer between."""
    assert set(ib.DIRECTION_SLOTS) <= set(ib.direction_fields())


def test_a_malformed_override_is_ignored_rather_than_raising():
    """Customer-authored jsonb sits between a credit deduction and an image. A
    typo in it must not turn a paid picture into a 500."""
    _, house = ib.art_direction_for(template_name="Campaign Launch")
    for junk in (None, {}, [], "palette", {"palette": 7}, {"nonsense": "x"},
                 {"style": "oil painting"}):
        assert isinstance(ib.apply_overrides(house, junk), ib.ArtDirection)
    assert ib.apply_overrides(house, {"style": "oil painting"}).style == house.style


# ══════════════════════════════════════════════════════════════════════════
# 5 · ASPECT RATIO — the surface the call site knows and the model cannot
# ══════════════════════════════════════════════════════════════════════════

def test_the_callers_explicit_ratio_always_wins():
    assert ib.aspect_for(requested="4:5") == "4:5"


def test_this_module_does_not_guess_a_ratio_from_a_platform():
    """`generate_image` resolves the frame from its preset, and those numbers
    came out of a measurement of what each provider will actually accept. A
    second table here would fight a measured one with a guess."""
    assert ib.aspect_for() is None
    assert ib.aspect_for(requested="") is None
    assert not hasattr(ib, "PLATFORM_RATIOS")


@pytest.mark.parametrize("name", sorted(CATALOGUE), ids=ib.slug)
def test_no_composition_asks_for_a_canvas_the_picture_will_not_be_rendered_on(name):
    """A composition that names a shape the frame does not have is not a shorter
    instruction, it is a contradictory one. Measured 2026-08-19: the reel visual
    said "vertical frame" on a preset that resolves to 1:1, and the festival
    card — the firm's most-posted image — said "square" on one that resolves to
    4:5, so its symmetrical border landed with uneven margins."""
    import services.ai_router as ar

    out = _compose(brief="x", template_name=name)
    _, direction = ib.art_direction_for(template_name=name)
    ratio = out.aspect_ratio or ar._resolve_preset(out.style)[1]["ratio"]
    w, h = ar._aspect_dims(ratio)

    words = direction.composition.lower()
    if "vertical" in words or "upright" in words or "portrait" in words:
        assert h > w, f"{name} composes upright and is rendered {ratio}"
    if "square" in words:
        assert h == w, f"{name} composes square and is rendered {ratio}"


def test_a_direction_that_names_its_own_frame_gets_it():
    """The reel is the one case: `product_shot` is 1:1 and a reel is 9:16."""
    out = _compose(brief="x", template_name="Weekly Reel Scripts")
    assert out.aspect_ratio == "9:16"


def test_the_frame_is_read_back_from_the_preset_rather_than_reported_as_none():
    """`quick_generate` names no ratio, so the surface line and the expansion
    call both printed "None" where the canvas should have been — the art
    director was asked to compose for a frame nobody had told it about."""
    import services.ai_router as ar

    for style in sorted(ib.STYLE_TOKENS):
        assert ib._preset_ratio(style) == ar._resolve_preset(style)[1]["ratio"]

    out = _compose(brief="x", skill="festival_campaign", platform="Instagram")
    assert "Surface: Instagram" in out.prompt
    assert "4:5" in out.prompt.split("Surface: ")[1]
    assert "None" not in out.prompt


@pytest.mark.parametrize("skill", sorted(hub.QUICK_SKILL_PROMPTS))
@pytest.mark.parametrize("topic_len", [20, 60])
def test_the_platform_the_reader_picked_reaches_the_model(skill, topic_len):
    """`quick_generate` passes the Platform dropdown straight through, and the
    only place it appears in the prompt is this line — which the budget dropped
    for `festival_campaign` and `blog_post`, so on those two the reader's choice
    reached the model in no form whatsoever. Asserted at the topic lengths a
    one-line field actually produces."""
    import services.ai_router as ar

    out = _compose(brief="q" * topic_len, skill=skill, platform="LinkedIn")
    assert "Surface: LinkedIn" in out.prompt, f"{skill}: the platform was dropped"
    stated = out.prompt.split("Surface: LinkedIn")[1].split("\n")[0]
    assert ar._resolve_preset(out.style)[1]["ratio"] in stated


def test_the_route_default_no_longer_squares_every_picture():
    """`OrgContentGenerate.aspect_ratio` used to default to "1:1", which is
    indistinguishable from a caller choosing a square — so a blog hero and a
    greeting card were both cropped by a value nobody asked for."""
    assert hub.OrgContentGenerate(agent_type="blog", brief="x").aspect_ratio is None


# ══════════════════════════════════════════════════════════════════════════
# 6 · THE EXPANSION FAILS SAFE
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_without_a_key_no_call_is_made_at_all(monkeypatch):
    """Which is also what keeps this suite offline."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    import services.ai_router as ar

    async def _boom(**kw):
        raise AssertionError("the expansion called a model with no key set")

    monkeypatch.setattr(ar, "generate", _boom)
    out = await ib.build_brief(brief="Diwali wishes", template_name="Festival Calendar")
    assert out.source == "template"
    assert "diya" in out.prompt


@pytest.mark.asyncio
async def test_a_failed_expansion_falls_back_to_the_house_brief(monkeypatch):
    """NOT to the old truncated string. The point of the fallback is that the
    floor is still a structured brief."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    import services.ai_router as ar

    async def _fail(**kw):
        raise RuntimeError("All AI providers failed")

    monkeypatch.setattr(ar, "generate", _fail)
    out = await ib.build_brief(brief="Diwali wishes", template_name="Festival Calendar")
    assert out.source == "template"
    assert "Subject:" in out.prompt and "Composition:" in out.prompt


@pytest.mark.asyncio
async def test_an_unparseable_expansion_falls_back(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    import services.ai_router as ar

    async def _prose(**kw):
        return {"text": "Sure! Here is an idea for your image."}

    monkeypatch.setattr(ar, "generate", _prose)
    out = await ib.build_brief(brief="Diwali wishes", template_name="Festival Calendar")
    assert out.source == "template"


@pytest.mark.asyncio
async def test_a_good_expansion_is_used_and_is_recorded_as_such(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    import services.ai_router as ar

    async def _ok(**kw):
        return {"text": (
            '```json\n{"subject": "a single brass oil lamp on a marigold '
            'garland", "palette": "vermilion and old gold"}\n```'
        )}

    monkeypatch.setattr(ar, "generate", _ok)
    out = await ib.build_brief(
        brief="Diwali wishes for clients", template_name="Festival Calendar",
        platform="Instagram",
    )
    assert out.source == "model"
    assert "a single brass oil lamp on a marigold garland" in out.prompt
    assert "vermilion and old gold" in out.prompt
    # The slots the model did NOT answer keep the house line.
    assert "dead overhead, upright frame" in out.prompt


@pytest.mark.asyncio
async def test_the_art_director_is_told_the_frame_it_is_composing_for(monkeypatch):
    """It was told "Frame: None" on essentially every image: only a caller that
    named a ratio passed one, and the route the Generate tab uses never does."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    import services.ai_router as ar

    seen = {}

    async def _capture(**kw):
        seen.update(kw)
        return {"text": "{}"}

    monkeypatch.setattr(ar, "generate", _capture)
    await ib.build_brief(brief="Diwali wishes", skill="festival_campaign",
                         platform="Instagram")
    assert "Frame: None" not in seen["prompt"]
    assert "Frame: 4:5" in seen["prompt"]


def _cheap_chain_agents():
    from services.ai_router import PREMIUM_AGENTS, QUALITY_AGENTS
    return set(PREMIUM_AGENTS) | set(QUALITY_AGENTS)


@pytest.mark.asyncio
async def test_the_expansion_is_cheap_and_short(monkeypatch):
    """One text call of a few hundred tokens against a four-cent image. If this
    ever routes to a premium chain the economics of the feature invert, and
    Aekam is the one absorbing the difference."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    import services.ai_router as ar

    seen = {}

    async def _capture(**kw):
        seen.update(kw)
        return {"text": "{}"}

    monkeypatch.setattr(ar, "generate", _capture)
    await ib.build_brief(brief="anything", template_name="Account brief")
    assert seen["max_tokens"] <= 512
    assert seen["language"] == "en"
    assert seen["agent_type"] not in _cheap_chain_agents()
    assert seen["task"] == "content"


@pytest.mark.asyncio
async def test_a_slop_field_from_the_model_is_dropped_per_field(monkeypatch):
    """Six good lines and one bad one is six lines better than the house brief.
    Discarding all seven to punish the one lowers quality."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    import services.ai_router as ar

    async def _mixed(**kw):
        return {"text": (
            '{"subject": "a stack of franked envelopes yellowing by age", '
            '"palette": "vibrant colours, high quality"}'
        )}

    monkeypatch.setattr(ar, "generate", _mixed)
    out = await ib.build_brief(brief="chase pack",
                               template_name="Receivables chase pack")
    assert "a stack of franked envelopes yellowing by age" in out.prompt
    assert not ib._SLOP_RE.search(out.prompt)
    assert "postal red" in out.prompt, "the house palette should have survived"


#: A real `hub_skill_templates.steps[].prompt_template`, at the length they
#: actually are. `run_org_skill` seeds the image brief from this, so this — not
#: a two-word topic — is what the description has to survive being joined to.
REAL_STEP_TEMPLATE = (
    "Write this week's Monday morning brief for the leadership team, in "
    "English. Use ONLY the figures in the context above. Structure it as: "
    "1. Where we stand - the KPIs for the week with the direction of travel. "
    "2. What moved - the projects and deals that changed state since last "
    "Monday. 3. What is slipping - the overdue tasks, grouped by who owns "
    "them. 4. What needs a decision this week. Keep every figure exactly as "
    "given; do not round, estimate or invent any number. No preamble."
)


@pytest.mark.asyncio
@pytest.mark.parametrize("brief", ["September quarter", "q" * 400,
                                   REAL_STEP_TEMPLATE])
async def test_the_skill_description_reaches_the_model(monkeypatch, brief):
    """The owner's actual words: "detailed image by description of skill". The
    description sat in the database and no route read it.

    Parametrised on the brief LENGTH, because the first version passed only for
    a seventeen-character one: joined as `brief — description` and condensed as
    one string, the description was the tail and went whole for every brief over
    ~320 characters — which is every catalogue template."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    description = ("Names every invoice in a period that would block or corrupt "
                   "a GSTR-1 filing.")
    out = await ib.build_brief(
        brief=brief, template_name="GSTR-1 filing readiness",
        template_description=description,
    )
    assert description in out.prompt
    assert brief.split(".")[0][:40] in out.prompt


def test_a_numbered_list_marker_is_not_a_sentence_boundary():
    """Condensing the real Monday Morning Brief template cut it at a bare "4."
    and handed the image model a dangling numeral, because every full stop was
    treated as the end of a sentence."""
    out = ib.condense(REAL_STEP_TEMPLATE, 420)
    assert not out.rstrip().endswith(("1.", "2.", "3.", "4.", "5."))


# ══════════════════════════════════════════════════════════════════════════
# 7 · THE CALL SITES
# ══════════════════════════════════════════════════════════════════════════

IMAGE_ROUTES = (hub.quick_generate, hub.generate_org_content, hub.run_org_skill)


def _generate_image_calls(fn):
    tree = ast.parse(inspect.getsource(fn).lstrip())
    return [n for n in ast.walk(tree)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
            and n.func.id == "generate_image"]


@pytest.mark.parametrize("fn", IMAGE_ROUTES, ids=lambda f: f.__name__)
def test_every_call_site_hands_the_built_prompt_to_the_generator(fn):
    """Structural, because a route that assembles a brief and then passes the
    raw topic anyway is the bug wearing the fix's clothes."""
    calls = _generate_image_calls(fn)
    assert calls, f"{fn.__name__} no longer generates an image"
    want = ast.dump(ast.parse("img_brief.prompt", mode="eval").body)
    for call in calls:
        kwargs = {kw.arg: kw.value for kw in call.keywords}
        assert "prompt" in kwargs
        assert ast.dump(kwargs["prompt"]) == want, (
            f"{fn.__name__} passes something other than the built prompt"
        )
        assert "style" in kwargs, f"{fn.__name__} leaves `style` dead again"
        assert "aspect_ratio" in kwargs


@pytest.mark.parametrize("fn", IMAGE_ROUTES, ids=lambda f: f.__name__)
def test_every_call_site_stores_the_prompt_it_used(fn):
    """Until now the prompt was built at the call site and thrown away, so a
    report of a bad picture was undiagnosable by anybody."""
    assert "as_metadata()" in inspect.getsource(fn), (
        f"{fn.__name__} makes an image and records nothing about how it asked"
    )


def test_the_old_adjective_prompts_are_gone_from_quick_generate():
    """On the STRINGS, not the source text — the comment above the call site
    quotes the old prompts on purpose, to say what was wrong with them."""
    tree = ast.parse(inspect.getsource(hub.quick_generate).lstrip())
    literals = " ".join(
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
    )
    for gone in ("scroll-stopping", "brand-quality", "eye-catching",
                 "Vibrant festive", "Create a professional"):
        assert gone not in literals, f"{gone!r} is still building a prompt"


def test_the_org_skill_runner_does_not_brief_the_picture_from_the_grounding():
    """`prompt` at that point carries the whole grounding block — thousands of
    characters of invoice rows. Briefing a picture from it asks the model to
    draw a spreadsheet."""
    src = inspect.getsource(hub.run_org_skill)
    assert 'step.get("image_prompt") or prompt_template' in src


def test_the_brand_row_reaches_every_call_site_that_has_one():
    for fn in IMAGE_ROUTES:
        assert "brand=dict(brand)" in inspect.getsource(fn), (
            f"{fn.__name__} loads a brand profile for the text and withholds it "
            f"from the picture"
        )


def test_the_org_override_is_read_from_the_column_that_already_exists():
    """No migration: staging and production share one Supabase database and the
    schema is owner-gated."""
    assert 'custom_config.get("image_brief")' in inspect.getsource(hub.run_org_skill)


def test_the_skill_description_and_category_are_actually_selected():
    """Both were columns nothing read. The description is the owner's requested
    input; the category is the fallback that stops a new skill getting none."""
    src = " ".join(inspect.getsource(hub.run_org_skill).split())
    assert "t.description as template_description" in src
    assert "t.category as template_category" in src


def test_the_metadata_record_is_diagnosable():
    out = _compose(brief="anything", template_name="Account brief")
    meta = out.as_metadata()
    assert meta["image_prompt"] == out.prompt
    assert meta["image_brief_source"] == "template"
    assert meta["image_art_key"] == "account-brief"
    assert set(meta) == {
        "image_prompt", "image_brief_source", "image_art_key", "image_style",
        "image_aspect_ratio",
    }


def test_the_brief_carries_no_field_that_reaches_nobody():
    """`ImageBrief.negative` held "; ".join(avoid) and was read by nothing:
    `generate_image` takes no negative parameter, `_build_image_prompt` sends
    `negative_prompt` to no provider on purpose, and `as_metadata` did not
    persist it. A dead field with a doc comment claiming a consumer is worse
    than no field, because the next reader believes it."""
    assert not hasattr(_compose(brief="x", template_name="Account brief"), "negative")


def test_the_reader_is_told_what_the_model_was_asked(monkeypatch):
    """`ImagePanel` reads `img.prompt` then `result.image_prompt`, and the
    Content tab reads `item.image_prompt`. No route returned either, so the
    diagnosis panel said "This run did not report the brief it built" on every
    run — the whole store-it-so-a-bad-picture-is-diagnosable chain severed at
    the response boundary."""
    src = inspect.getsource(hub.quick_generate)
    assert '"prompt": img_brief.prompt' in src, \
        "the image carries no brief, so the panel that shows it has nothing"
    assert '"image_prompt": img_brief.prompt if img_brief else ""' in src, \
        "a run whose image FAILED has no image to hang the brief on"
    assert '"image_prompt": img_brief.prompt if img_brief else ""' in \
        inspect.getsource(hub.generate_org_content)


@pytest.mark.asyncio
async def test_the_stored_brief_is_lifted_out_of_metadata_on_the_way_out(monkeypatch):
    """It lives in the `metadata` jsonb because there is no column for it and
    this agent may not add one — the two environments share a database. The
    frontend reads `item.image_prompt` and nothing reads `item.metadata`."""
    async def _sign(org_id, key):
        return "https://r2.invalid/fresh"

    monkeypatch.setattr("services.storage.sign_key", _sign)
    items = [{"image_url": "https://r2.invalid/a.png", "image_key": "a.png",
              "metadata": {"image_prompt": "A rich still-life photograph…"}},
             {"image_url": None, "metadata": None}]
    out = await hub.sign_content_images("org", items)
    assert out[0]["image_prompt"] == "A rich still-life photograph…"
    assert "image_prompt" not in out[1], "a row with no picture gained a field"


def test_a_failed_picture_is_reported_rather_than_silently_absent():
    """Every provider failing raised, was caught, refunded and logged — and the
    reply carried an empty image list and no error. The result pane guards on
    `images.length > 0` and simply omitted the column, so the natural next move
    was to click Generate again and pay for a second full text run."""
    for fn in (hub.quick_generate, hub.generate_org_content, hub.run_org_skill):
        src = inspect.getsource(fn)
        assert '"image_error": image_error' in src, \
            f"{fn.__name__} returns no picture and does not say so"
        assert "image_error = (" in src


def test_the_mime_the_provider_answered_with_is_the_one_reported():
    """Recraft V4 answers image/webp and Gemini image/jpeg. `"image/png"` was a
    literal here, and it was persisted into `metadata.images` and returned to
    the client, so the reply, the jsonb and the file the reader downloads all
    named a format the bytes are not."""
    src = inspect.getsource(hub.quick_generate)
    assert 'img_result.get("mime")' in src
    assert '"mime": "image/png"' not in src


def test_the_regenerate_control_is_a_field_the_request_model_declares():
    """`GenerateTab` sends `image_prompt` on "Generate a new image". The model
    did not declare it, so Pydantic dropped it and the route re-briefed the
    picture from `topic` — the brief the reader had just rejected, charged for
    again."""
    assert "image_prompt" in hub.QuickGenerate.model_fields
    assert hub.QuickGenerate(skill="social_post", topic="x",
                             image_prompt="a sweet shop at dusk").image_prompt
    assert "body.image_prompt.strip() or body.topic" in \
        inspect.getsource(hub.quick_generate)


# ══════════════════════════════════════════════════════════════════════════
# 8 · THE HANDOFF TO `generate_image`
# ══════════════════════════════════════════════════════════════════════════

def test_every_style_this_module_emits_resolves_downstream():
    """`style` used to be accepted by `generate_image` and read by nothing. It
    is read now, and it selects the preset that supplies the frame and the
    lettering rule — so a token this module invents would silently land every
    picture on `auto` and lose the festival and banner handling."""
    import services.ai_router as ar

    assert hasattr(ar, "_resolve_preset"), (
        "`generate_image` no longer resolves `style` to a preset. Either it "
        "reads style some other way — point `ArtDirection.style` at that — or "
        "it has gone dead again, which is the defect this replaced."
    )
    for token in sorted(ib.STYLE_TOKENS):
        name, _ = ar._resolve_preset(token)
        assert name == token, (
            f"style {token!r} resolves to {name!r} downstream — the preset names "
            f"have moved and STYLE_TOKENS has not"
        )


@pytest.mark.parametrize("name", sorted(CATALOGUE), ids=ib.slug)
def test_every_skill_emits_a_style_the_router_knows(name):
    import services.ai_router as ar

    out = _compose(brief="x", template_name=name)
    assert out.style in ib.STYLE_TOKENS
    assert ar._resolve_preset(out.style)[0] == out.style


def test_the_prompt_is_composed_to_fit_what_the_router_will_forward():
    """`_build_image_prompt` slices the caller's brief at `_SUBJECT_LIMIT` and
    then appends its own preset direction. A prompt written without knowing that
    number loses its tail there instead — the same defect, one layer down."""
    import services.ai_router as ar

    assert isinstance(getattr(ar, "_SUBJECT_LIMIT", None), int), (
        "`generate_image` no longer publishes how much of a prompt it forwards. "
        "`image_brief._downstream_budget` reads that number; without it this "
        "module composes blind and the router takes the tail off again."
    )
    for name in CATALOGUE:
        out = ib.compose_brief(
            brief=LONG_BRIEF, art_key=ib.slug(name),
            direction=ib.art_direction_for(template_name=name)[1],
        )
        assert len(out.prompt) <= ar._SUBJECT_LIMIT, (
            f"{name}: {len(out.prompt)} characters will be cut at "
            f"{ar._SUBJECT_LIMIT} by the router"
        )


def test_the_helper_in_this_file_composes_at_the_budget_production_uses():
    """The ratchet on the tests themselves. `_compose` defaulted to
    `budget=None` and every structure assertion above certified a prompt no
    customer has ever received."""
    import services.ai_router as ar

    trimmed = _compose(brief=LONG_BRIEF, template_name="Festival Calendar")
    whole = _untrimmed(brief=LONG_BRIEF, template_name="Festival Calendar")
    assert len(trimmed.prompt) <= ar._SUBJECT_LIMIT
    assert len(whole.prompt) > len(trimmed.prompt), (
        "`_compose` is not trimming, so it is not composing the way the routes do"
    )


def test_the_budget_drops_whole_lines_and_never_half_a_sentence():
    """A half-sentence of art direction reads to the encoder as a different
    instruction, not as a shorter one."""
    out = ib.compose_brief(
        brief="a small brass diya", budget=260,
        direction=ib.art_direction_for(template_name="Festival Calendar")[1],
    )
    assert len(out.prompt) <= 260
    for line in out.prompt.split("\n")[1:]:
        assert line.endswith("."), f"line was cut mid-sentence: {line!r}"


def test_the_subject_leads_and_the_dropped_lines_are_the_restated_ones():
    """The brief leads and is never the thing that goes. What goes is Setting
    and Mood — the two whose loss changes the picture least — and NOT the avoid
    list, which used to be first out on the reasoning that "the router restates
    it". It does not: `_GLOBAL_AVOID` plus the preset's own avoid contains
    neither the stock-photo clichés nor the glowing circuitry this module names
    as the slop signature, and its festival line permits the deity."""
    import services.ai_router as ar

    out = ib.compose_brief(
        brief="a small brass diya", budget=300,
        direction=ib.art_direction_for(template_name="Festival Calendar")[1],
    )
    assert out.prompt.index("brass diya") < 200

    restated = f"{ar._GLOBAL_AVOID} {ar._IMAGE_PRESETS['festival_greeting']['avoid']}"
    for unrestated in ("stock-photo clichés", "glowing blue circuitry"):
        assert unrestated not in restated, (
            "the router now restates this, so the priority order below is stale"
        )


def test_the_avoid_list_yields_clauses_rather_than_the_whole_line():
    """A clause is a whole instruction, so dropping one is not the mid-sentence
    cut this module refuses everywhere else — and the per-template bans sit at
    the head, so the last thing standing is the one nobody else says."""
    direction = ib.art_direction_for(template_name="Festival Calendar")[1]
    full = ib._fit_avoid(direction.avoid, ib.HOUSE_AVOID, None)
    tight = ib._fit_avoid(direction.avoid, ib.HOUSE_AVOID, 60)
    assert full.count(";") > tight.count(";")
    assert "depictions of any deity" in tight
    assert tight.endswith(".")
    assert ib._fit_avoid((), (), None) is None


def test_the_budget_follows_the_router_rather_than_restating_it(monkeypatch):
    """Read, not copied. If the encoder limit moves, this moves with it."""
    import services.ai_router as ar

    monkeypatch.setattr(ar, "_SUBJECT_LIMIT", 320)
    out = ib.compose_brief(
        brief=LONG_BRIEF,
        direction=ib.art_direction_for(template_name="Account brief")[1],
    )
    assert len(out.prompt) <= 320
