"""The image half of `ai_router`: the brief, the ladder, and the fetch.

Owner, 2026-08-19: "better image creation quality less AI slop and detailed
image by description of skill".

What was actually being sent to the model, until that day:

    "Create a professional image for: " + prompt[:200]

The skill's own description — the festival, the firm, the service being
explained — cut at two hundred characters and hidden behind a prefix that
describes nothing. No composition, no lighting, no palette, no negatives. That
one line is the slop. `style` was accepted and never read by any branch, and the
step meant to lead the ladder had been answering `410 Gone` since HuggingFace
retired its serverless route for FLUX.1-dev, so every picture the product ever
made came from the lite model at the bottom while FLUX.2 Pro sat unreachable
behind it.

MEASURED 2026-08-19 against the org's own keys, one brief, five models. The
findings these tests defend:

  · Nobody here can spell Devanagari. Given "शुभ दीपावली", FLUX.2 Pro drew
    "शुथ हिपावली" and Recraft V4 drew "सुभ रीपदलीं" — confidently, and wrong,
    in a script the firm's clients read. The one frame with nothing wrong with
    it came from the model that was told not to attempt lettering at all.
  · Recraft V4 sets LATIN type perfectly: "Sharma & Associates / Chartered
    Accountants | Ahmedabad", letter for letter. Nothing else came close.
  · The Gemini image model reads its own instructions as copy. Told to "leave
    clean empty space for a headline", it typeset the words CLEAN SPACE into
    the picture in a centred serif.
  · `negative_prompt` cannot be shown to do anything: fal accepts it with a
    200, and a fixed-seed A/B cannot settle it because two identical calls at
    seed 12345 returned different bytes.
  · Only FLUX.2 Pro returns PNG. Recraft answers WebP and Gemini answers JPEG,
    and every one of them was being stored as `srijan-xxxx.png`.

OFFLINE, like the rest of the suite. Every provider call is stubbed; the two
API keys are fake strings that exist only so the ladder branches are reachable.
"""
import inspect

import httpx
import pytest

import services.ai_router as R


ORG = "11111111-1111-1111-1111-111111111111"

# The two fal routes, named off `_FAL_ROUTES` rather than spelled out, so a
# route that moves cannot leave these tests asserting against a dead string.
DEV = R._FAL_ROUTES["fal_flux_dev"][1]
SCHNELL = R._FAL_ROUTES["fal_flux_schnell"][1]
RECRAFT = "recraft/recraft-v4"
FLUX2 = "black-forest-labs/flux.2-pro"
LITE = "google/gemini-3.1-flash-lite-image"

# 640 characters. The old truncation kept the first 200 of them.
LONG_BRIEF = (
    "Diwali greeting card for Sharma & Associates, a chartered accountancy firm "
    "in Ahmedabad serving family-owned manufacturers across Gujarat, wishing "
    "clients a prosperous new financial year and thanking them for eleven years "
    "of trust. The firm's palette is deep indigo and brass. The card sits on a "
    "dark desk beside a ledger and a brass diya, photographed from slightly "
    "above, with a garland of marigolds curling in from the left edge and a "
    "clear band across the top where the greeting will be set. NEEDLE: ledger."
)


@pytest.fixture(autouse=True)
def _keys(monkeypatch):
    """Both providers present, so every rung of the ladder is reachable. The
    values are never sent anywhere — every helper below is stubbed."""
    monkeypatch.setenv("HF_API_KEY", "hf-not-a-real-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-not-a-real-key")
    monkeypatch.delenv("GEMINI_IMAGE_ENABLED", raising=False)


# ══════════════════════════════════════════════════════════════════════════════
# 1 · THE BRIEF
# ══════════════════════════════════════════════════════════════════════════════

def test_the_whole_brief_reaches_the_model():
    """The needle sits at character 630 of the brief — past the old cut.

    Not a length assertion: a prompt can be long and still have lost the end of
    what the user wrote, which is precisely what `prompt[:200]` did.
    """
    _, preset = R._resolve_preset("festival_greeting")
    built = R._build_image_prompt(LONG_BRIEF, preset)
    assert "NEEDLE: ledger" in built, (
        "the tail of the brief did not survive — the subject is being truncated "
        "again, which is the bug this whole change exists to remove"
    )
    assert LONG_BRIEF.index("NEEDLE") > 200, "this fixture no longer tests a cut"


def test_the_prefix_that_described_nothing_is_gone():
    _, preset = R._resolve_preset("auto")
    assert "Create a professional image for" not in R._build_image_prompt("a diya", preset)


def test_the_subject_leads_so_the_encoder_drops_the_avoid_list_first():
    """FLUX encodes with T5 at 512 tokens. Something has to be last, and it must
    not be the thing the user asked for."""
    _, preset = R._resolve_preset("auto")
    built = R._build_image_prompt("a brass diya on a ledger", preset)
    assert built.index("brass diya") < built.index("Avoid:")


def test_a_brief_longer_than_the_ceiling_is_bounded_rather_than_unbounded():
    """Bounded, but at 700 rather than 200 — the whole prompt still has to fit
    inside one T5 window or the negatives fall off the end instead."""
    built = R._build_image_prompt("x" * 5_000, R._IMAGE_PRESETS["auto"])
    assert "x" * R._SUBJECT_LIMIT in built
    assert "x" * (R._SUBJECT_LIMIT + 1) not in built


# ── style: the argument that was accepted and never read ─────────────────────

def test_style_changes_the_picture():
    """`generate_image` has always taken `style` and no branch ever read it."""
    brief = "our team at work"
    team = R._build_image_prompt(brief, R._resolve_preset("team_card")[1])
    shot = R._build_image_prompt(brief, R._resolve_preset("product_shot")[1])
    assert team != shot
    assert "35mm" in team and "35mm" not in shot
    assert "seamless neutral sweep" in shot and "seamless neutral sweep" not in team


@pytest.mark.parametrize("style", ["", None, "auto", "not-a-preset", "  FESTIVAL_GREETING  "])
def test_an_unusable_style_falls_back_instead_of_raising(style):
    """`style` arrives from a skill template's JSON. An un-specialised picture
    beats a 500 on a route the customer has already been charged for."""
    name, preset = R._resolve_preset(style)
    assert name in R._IMAGE_PRESETS
    assert R._build_image_prompt("a diya", preset)


def test_the_hub_skill_names_land_on_a_real_preset_not_on_auto():
    """The content routes pass their own skill through. Each one that has a
    preset must reach it, or the aliases have silently gone stale."""
    for skill, expected in (
        ("festival_campaign", "festival_greeting"),
        ("blog_post", "blog_hero"),
        ("ad_copy", "product_shot"),
    ):
        assert R._resolve_preset(skill)[0] == expected


@pytest.mark.parametrize("name", sorted(R._IMAGE_PRESETS))
def test_every_preset_carries_its_own_direction_and_its_own_negative(name):
    """A preset that only names a style is half a preset. The owner asked for
    less slop, and slop is what the negatives are for."""
    preset = R._IMAGE_PRESETS[name]
    assert len(preset["direction"]) > 60, f"{name} has no real style direction"
    assert len(preset["avoid"]) > 20, f"{name} carries no negative direction"
    assert preset["ratio"] in R._ASPECT_DIMS, f"{name} defaults to a frame with no pixels"
    assert isinstance(preset["typographic"], bool)


# ── the preset is a default, not an overlay ──────────────────────────────────
#
# A brief that arrives from `services/image_brief.py` already names a medium, a
# composition and a light chosen for that template. The preset's own line used
# to be appended on top of all three, and the result asked one model for two
# pictures at once.


def _composed(template_name="Festival Calendar", platform="instagram", **kw):
    """A real brief from the composing module, not a hand-written imitation.

    Deterministic and offline: `compose_brief` makes no call. Using the real
    thing is the point — the router recognises this shape by a string the other
    module emits, so if that lead sentence ever changes these go red rather
    than the product quietly generating two directions again.
    """
    from services import image_brief as ib

    art_key, direction = ib.art_direction_for(template_name=template_name)
    return ib.compose_brief(brief="Diwali wishes for our clients",
                            direction=direction, art_key=art_key,
                            platform=platform, **kw)


def test_a_composed_brief_is_recognised_as_already_directed():
    assert R._is_art_directed(" ".join(_composed().prompt.split())) is True


def test_a_brief_a_person_typed_still_gets_the_presets_direction():
    """The case that was already working, and must keep working: the Generate
    tab passes whatever the user wrote and nothing else."""
    assert R._is_art_directed("a brass diya on a ledger") is False
    built = R._build_image_prompt("a brass diya on a ledger",
                                  R._IMAGE_PRESETS["product_shot"])
    assert "seamless neutral sweep" in built


def test_the_picture_is_never_given_two_compositions_or_two_lights():
    """MEASURED 2026-08-19 on the Festival Calendar template. The prompt that
    left this process carried, in one string:

        Composition: symmetrical border … dead overhead, square
        Composition and style: … editorial poster layout with a clear
                               uncluttered band across the upper third
        Lighting: low-key, lit almost entirely by the diya flames
        … soft directional light
        A rich still-life photograph, fine grain / festive Indian greeting card

    A still life shot from overhead by candlelight and a flat printed card lit
    softly from one side are not the same photograph. A text encoder handed both
    averages them, which is the look this whole path exists to stop.
    """
    brief = _composed()
    built = R._build_image_prompt(brief.prompt, R._resolve_preset(brief.style)[1])
    assert built.count("Composition") == 1
    assert built.count("Lighting") == 1
    assert "Composition and style:" not in built
    # The router's own contributions still arrive — they are facts about the
    # ladder and the frame, not opinions about the picture.
    assert "Lettering:" in built and "Finish:" in built and "Avoid:" in built


def test_the_composed_brief_does_not_arrive_with_a_doubled_full_stop():
    """It ends in one and the scaffolding adds another, which put ".." in the
    middle of every prompt on the composed path."""
    brief = _composed()
    built = R._build_image_prompt(brief.prompt, R._resolve_preset(brief.style)[1])
    assert ".." not in built


# ══════════════════════════════════════════════════════════════════════════════
# 2 · NEGATIVE PROMPTING, AND THE TEXT FAILURE MODE
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("name", sorted(R._IMAGE_PRESETS))
def test_the_slop_signature_is_named_in_every_brief(name):
    """Garbled lettering leads the list because it is the tell a viewer who
    cannot name a single other artefact will still read."""
    built = R._build_image_prompt("a diya", R._IMAGE_PRESETS[name])
    assert "garbled or misspelt text" in built
    for artefact in ("fused fingers", "waxy plastic skin", "watermark"):
        assert artefact in built, f"{name} does not warn against {artefact}"


def test_a_picture_that_is_not_about_words_is_told_to_have_none():
    """The cheapest anti-slop measure there is: an image with no words in it
    cannot have misspelt words in it."""
    built = R._build_image_prompt("our team at work", R._IMAGE_PRESETS["team_card"])
    assert "no text, lettering, captions, logos or watermarks" in built


def test_a_typographic_preset_asks_for_a_clean_band_rather_than_invented_letters():
    """The measured result: the only frame of five with nothing wrong with it
    was the one told to leave the space empty."""
    built = R._build_image_prompt("Diwali card", R._IMAGE_PRESETS["festival_greeting"])
    assert "leave a clean uncluttered band" in built
    assert "draw no letters, words or numerals" in built


@pytest.mark.parametrize("name", sorted(R._IMAGE_PRESETS))
def test_no_preset_ever_invites_a_model_to_spell(name):
    """The typographic branch used to open "any words must be short and
    correctly spelled in the Latin alphabet".

    Two things were wrong with it. It contradicted the measurement in this
    module's docstring — nothing in the ladder spells reliably, and the one
    clean frame came from the model told not to try. And it contradicted the
    brief arriving from `services/image_brief.py`, whose first house negative is
    "any lettering, words, numerals, captions or signage inside the frame" —
    a line that sits last in that module's budget and is dropped before it gets
    here on exactly the festival path where this mattered most. The picture was
    left with one instruction about words and it was the wrong one.
    """
    for conversational in (False, True):
        built = R._build_image_prompt("Diwali card for our clients",
                                      R._IMAGE_PRESETS[name],
                                      conversational=conversational)
        assert "correctly spelled" not in built
        assert "must be short" not in built
        assert "no letters" in built or "no text, lettering" in built


def test_devanagari_in_the_brief_is_never_handed_back_to_the_model():
    """FLUX.2 Pro drew "शुथ हिपावली". Recraft drew "सुभ रीपदलीं". Both wrong, in
    a script the firm's own clients read — so it is not asked for."""
    built = R._build_image_prompt(
        'Diwali card carrying the words "शुभ दीपावली"',
        R._IMAGE_PRESETS["festival_greeting"],
    )
    assert "do not attempt Devanagari" in built


def test_an_english_brief_is_not_burdened_with_the_indic_rule():
    built = R._build_image_prompt("Diwali card", R._IMAGE_PRESETS["festival_greeting"])
    assert "do not attempt Devanagari" not in built


def test_one_indic_word_is_caught_where_the_routing_detector_would_miss_it():
    """`detect_language` needs a fifth of the letters before it calls a message
    Indic — right for routing a conversation, wrong here. This is the whole
    reason `_has_non_latin_script` exists rather than reusing it."""
    brief = 'Diwali greeting card for a chartered accountancy firm in Ahmedabad saying "शुभ दीपावली"'
    assert R.detect_language(brief) == "en"
    assert R._has_non_latin_script(brief) is True
    assert R._has_non_latin_script("Diwali greeting card") is False


def test_the_conversational_string_says_its_own_words_are_not_copy():
    """Told to "leave clean empty space for a headline", the Gemini image model
    typeset CLEAN SPACE into the picture, centred, in a serif face. It reads the
    brief as copy as much as direction, so that branch says so outright."""
    built = R._build_image_prompt("Diwali card", R._IMAGE_PRESETS["festival_greeting"],
                                  conversational=True)
    assert "never typeset any of them into it" in built
    assert "Avoid:" not in built, (
        "the bare Avoid: list is what a diffusion model wants; this model sets "
        "stray directives in type"
    )


# ── the slop vocabulary, scanned where it actually leaves the process ────────


def _router_contributed(preset, conversational=False):
    """Everything the ROUTER puts in the prompt, with no customer text in it.

    Scanned with an empty subject on purpose. A customer is allowed to type
    "professional" — the skill templates in the catalogue do, and censoring the
    brief is how the 200-character prefix was justified in the first place. What
    is not allowed is this file adding it.
    """
    return R._build_image_prompt("", preset, conversational=conversational)


@pytest.mark.parametrize("name", sorted(R._IMAGE_PRESETS))
@pytest.mark.parametrize("conversational", [False, True])
def test_the_assembled_prompt_carries_no_slop_vocabulary(name, conversational):
    """The ratchet in `tests/test_skill_image_brief.py` scans `compose_brief`'s
    output. Nothing scanned the string this file assembles on top of it, and
    that string was shipping the word the whole list is led by.

    `_QUALITY_SPINE` ended "professional colour grading", so every image from
    every route — composed brief or not, cheap rung or dear — closed on the
    first entry in `image_brief.SLOP_WORDS`. Two preset directions said
    "professional services firm" on top of it. "professional" describes nothing
    a camera or a hand could do differently, so the model resolves it to the
    mean of its training set, and that mean is the look the owner opened the day
    by complaining about.
    """
    from services import image_brief as ib

    hits = ib._SLOP_RE.findall(_router_contributed(R._IMAGE_PRESETS[name], conversational))
    assert hits == [], f"{name} ships {sorted(set(h.lower() for h in hits))} to the model"


def test_that_slop_scan_can_actually_fail():
    """Worth its runtime only if it can go red. The list has to be the one
    `image_brief` publishes, not a copy of it that could go stale."""
    from services import image_brief as ib

    assert "professional" in ib.SLOP_WORDS
    assert ib._SLOP_RE.findall("professional colour grading") == ["professional"]


def test_the_finish_line_does_not_argue_with_a_shallow_depth_of_field():
    """`_QUALITY_SPINE` said "sharp focus" while three presets ask for a soft
    background. One frame-wide sharpness order on top of them is two directions
    fighting, not one repeated."""
    assert "sharp focus" not in R._QUALITY_SPINE
    soft = [n for n, p in R._IMAGE_PRESETS.items()
            if "shallow" in p["direction"] or "background blur" in p["direction"]]
    assert soft, "this test is only worth its runtime while such a preset exists"
    for name in soft:
        built = R._build_image_prompt("a brass diya", R._IMAGE_PRESETS[name])
        assert "sharp focus" not in built


@pytest.mark.parametrize(
    "fn", [R._generate_hf_image, R._generate_openrouter_image, R._generate_gemini_imagen],
    ids=lambda f: f.__name__,
)
def test_no_provider_is_sent_a_negative_prompt_parameter(fn):
    """Not one model here has a `negative_prompt` that can be shown to work.

    fal accepts the key and answers 200 — it does not reject it, which is worse
    than rejecting it, because it looks like it works. A fixed-seed A/B cannot
    settle it either: two identical calls at seed 12345 returned different
    bytes, so there is nothing to compare. FLUX.1 is guidance-distilled at CFG 1
    and has no mechanism for one. Sending the key anyway would be a parameter
    that silently does nothing, which is how `style` came to be dead for months.
    """
    body = inspect.getsource(fn)
    assert '"negative_prompt"' not in body and "'negative_prompt'" not in body


def test_that_scan_can_actually_fail():
    """Worth its runtime only if it can go red. Prove it."""
    with pytest.raises(AssertionError):
        test_no_provider_is_sent_a_negative_prompt_parameter(
            lambda: {"negative_prompt": "garbled text"}
        )


# ══════════════════════════════════════════════════════════════════════════════
# 3 · THE FRAME
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("ratio", sorted(R._ASPECT_DIMS))
def test_every_frame_is_a_size_a_diffusion_model_will_accept(ratio):
    w, h = R._aspect_dims(ratio)
    assert w % 16 == 0 and h % 16 == 0, "fal rounds to 16 anyway; do it here where it reads"
    assert 512 <= w <= 1536 and 512 <= h <= 1536


def test_a_wide_frame_is_actually_wide():
    """A 1:1 square posted to LinkedIn is a crop, and the route the Generate tab
    uses passed no ratio at all, so everything it made was square."""
    w, h = R._aspect_dims("16:9")
    assert w > h
    assert abs((w / h) - (16 / 9)) < 0.05


@pytest.mark.parametrize("ratio", ["1:10000", "10000:1", "0:1", "1:0", "-3:4"])
def test_a_degenerate_ratio_is_clamped_rather_than_obeyed(ratio):
    """`aspect_ratio` arrives from a request body. "1:10000" is a valid string
    and a wasted generation."""
    w, h = R._aspect_dims(ratio)
    assert 512 <= w <= 1536 and 512 <= h <= 1536
    assert 0.2 <= (w / h) <= 5.0


@pytest.mark.parametrize("ratio", ["", None, "square", "16x9", "::"])
def test_an_unreadable_ratio_falls_back_to_the_square(ratio):
    assert R._aspect_dims(ratio) == R._ASPECT_DIMS["1:1"]


def test_an_unlisted_but_sane_ratio_is_computed_not_discarded():
    w, h = R._aspect_dims("21:9")
    assert w > h and w % 16 == 0 and h % 16 == 0


# ── and the frame the OpenRouter rungs will actually take ────────────────────

@pytest.mark.parametrize("ratio", sorted(R._ASPECT_DIMS) + ["21:9", "nonsense", ""])
def test_every_frame_snaps_to_one_openrouter_accepts(ratio):
    """OpenRouter validates `aspect_ratio` per model and answers 400 rather
    than picking something near. Measured 2026-08-19: Recraft V4 takes
    1:1, 4:3, 3:4, 16:9, 9:16 and nothing else, and the endpoint's own schema
    rejects "1.91:1" outright with a ZodError.

    This is not theoretical. `festival_greeting` defaults to 4:5 and leads with
    Recraft, so the flagship preset 400d on its own lead the first time the real
    ladder was driven against the live providers.
    """
    assert R._openrouter_ratio(ratio) in R._OPENROUTER_RATIOS


@pytest.mark.parametrize("ratio,expected", [
    ("4:5", "3:4"),        # Instagram portrait → 0.80 becomes 0.75
    ("5:4", "4:3"),
    ("2:3", "3:4"),
    ("3:2", "4:3"),
    ("1.91:1", "16:9"),    # the OG card the endpoint schema refuses outright
    ("9:16", "9:16"),
    ("1:1", "1:1"),
])
def test_the_snap_keeps_the_shape_it_was_given(ratio, expected):
    """Nearest in log space, so a portrait brief can never land on a landscape
    frame — which a linear nearest-match does at exactly the ratios this
    product uses."""
    assert R._openrouter_ratio(ratio) == expected


@pytest.mark.parametrize("ratio", ["4:5", "2:3", "9:16"])
def test_a_portrait_never_snaps_to_a_landscape(ratio):
    w, h = R._ASPECT_DIMS[R._openrouter_ratio(ratio)]
    assert h > w


async def test_the_lead_rung_keeps_the_exact_frame_the_fallbacks_have_to_round(spy):
    """fal takes real dimensions, so the frame the preset chose is delivered as
    asked whenever step one answers — which is most of the time. Only the
    fallbacks compromise, and only as far as the nearest frame they accept."""
    spy.fail |= {DEV, SCHNELL}
    await R.generate_image(prompt="Diwali card", style="auto",
                           aspect_ratio="4:5", org_id=ORG)
    calls = dict(spy.calls)
    assert (calls[DEV]["w"], calls[DEV]["h"]) == (896, 1120)
    assert (calls[SCHNELL]["w"], calls[SCHNELL]["h"]) == (896, 1120)
    # `_generate_openrouter_image` snaps inside itself, so what the spy records
    # is what `generate_image` handed over. The snap is asserted directly above.
    assert calls[RECRAFT]["ratio"] == "4:5"
    # The snap itself happens inside `_generate_openrouter_image`, so that every
    # caller of that helper is covered rather than only this one. Asserted on
    # the outgoing body in `test_the_snapped_frame_is_what_leaves_the_process`.
    assert R._openrouter_ratio("4:5") == "3:4"


# ══════════════════════════════════════════════════════════════════════════════
# 4 · THE LADDER
# ══════════════════════════════════════════════════════════════════════════════

class _Spy:
    """Records which rung was called with what, and answers like a provider.

    `raises` overrides the default failure with a specific exception, which is
    how the retry tests tell a 429 apart from a 400 — the whole point of
    `_ImageProviderError` carrying a status.
    """

    def __init__(self, fail: set[str] = frozenset()):
        self.calls: list[tuple[str, dict]] = []
        self.fail = set(fail)
        self.raises: dict[str, Exception] = {}

    def _fail(self, model, default):
        raise self.raises.get(model) or default

    def hf(self):
        async def _fn(api_key, prompt, width=1024, height=1024, *, step="fal_flux_dev"):
            _path, model, price = R._FAL_ROUTES[step]
            self.calls.append((model, {"prompt": prompt, "w": width, "h": height}))
            if model in self.fail:
                self._fail(model, RuntimeError("410 Gone"))
            return {"image_bytes": b"PNG", "mime": "image/png",
                    "provider": "huggingface", "model": model, "cost_usd": price}
        return _fn

    def openrouter(self, mime_by_model=None):
        mimes = mime_by_model or {}

        async def _fn(api_key, prompt, aspect_ratio="1:1", model="x"):
            self.calls.append((model, {"prompt": prompt, "ratio": aspect_ratio}))
            if model in self.fail:
                self._fail(model, RuntimeError("provider said no"))
            return {"image_bytes": b"IMG", "mime": mimes.get(model, "image/png"),
                    "provider": "openrouter", "model": model, "cost_usd": 0.04}
        return _fn


@pytest.fixture
def spy(monkeypatch):
    s = _Spy()
    monkeypatch.setattr(R, "_generate_hf_image", s.hf())
    monkeypatch.setattr(R, "_generate_openrouter_image", s.openrouter())
    # The retry is real and its wait is not. Every ladder test below would
    # otherwise pay 1.5s per transient failure.
    monkeypatch.setattr(R, "_IMAGE_RETRY_DELAY_S", 0)

    uploads = []

    async def _upload(**kw):
        uploads.append(kw)
        return {"url": "https://r2.invalid/x?sig=1", "key": "srijan/images/x"}

    monkeypatch.setattr("services.storage.upload_file", _upload)
    s.uploads = uploads
    return s


def _order(spy):
    return [model for model, _ in spy.calls]


async def test_the_lead_is_the_cheap_good_model_not_the_lite_one(spy):
    """The lite model was the DEFAULT, because the rung above it was dead.

    It is now the floor: at $0.034 it is dearer than the $0.025 lead, and it
    typesets stray instructions into the picture.
    """
    await R.generate_image(prompt="a brass diya", style="auto", org_id=ORG)
    assert _order(spy) == [DEV]


async def test_the_most_posted_image_no_longer_leads_with_the_dearest_rung(spy):
    """`festival_greeting` used to lead with Recraft at $0.04, because Recraft
    is the only model measured that spells a firm's name letter for letter.

    Nothing asks any model to spell any more, so that reason is spent — and it
    was being paid on the image an Indian firm posts more than any other. One
    ladder for every preset now, and it opens on the cheapest rung.
    """
    await R.generate_image(prompt="Diwali card", style="festival_greeting", org_id=ORG)
    assert _order(spy) == [DEV]
    assert R._IMAGE_PRESETS["festival_greeting"]["typographic"] is True, (
        "this test is only worth its runtime while a typographic preset exists "
        "to be reordered"
    )


async def test_the_first_fallback_is_cheaper_than_the_lead_not_dearer(spy):
    """The ladder used to escalate in price and nowhere else: a lead that failed
    sent the whole run to a $0.04 model.

    Aekam absorbs this out of a flat INR subscription, so the rung after the
    lead is the other fal route — same family, same request, a fraction of the
    price — and every paid model sits behind it.
    """
    spy.fail |= {DEV}
    result = await R.generate_image(prompt="a brass diya", style="auto", org_id=ORG)
    assert _order(spy) == [DEV, SCHNELL]
    assert result["model"] == SCHNELL
    assert R._FAL_ROUTES["fal_flux_schnell"][2] < R._FAL_ROUTES["fal_flux_dev"][2]


async def test_the_ladder_falls_all_the_way_through_in_quality_order(spy):
    spy.fail |= {DEV, SCHNELL, RECRAFT, FLUX2}
    result = await R.generate_image(prompt="a brass diya", style="auto", org_id=ORG)
    assert _order(spy) == [DEV, SCHNELL, RECRAFT, FLUX2, LITE]
    assert result["model"] == LITE


async def test_the_lite_model_is_never_reached_while_a_better_one_answers(spy):
    spy.fail |= {DEV}
    await R.generate_image(prompt="a brass diya", style="auto", org_id=ORG)
    assert LITE not in _order(spy)


async def test_the_lite_model_is_handed_the_string_built_for_it(spy):
    """It reads the prompt as copy, so it gets the conversational build and not
    the diffusion one — see the CLEAN SPACE frame in this module's docstring."""
    spy.fail |= {DEV, SCHNELL, RECRAFT, FLUX2}
    await R.generate_image(prompt="Diwali card", style="auto", org_id=ORG)
    sent = dict(spy.calls)[LITE]["prompt"]
    assert "never typeset any of them into it" in sent


async def test_every_rung_gets_the_built_brief_and_not_the_bare_one(spy):
    """Whichever provider answers, it answers a brief. This is the regression
    that mattered: the enrichment lives inside `generate_image`, so no call site
    can be the one that forgot."""
    spy.fail |= {DEV, SCHNELL, RECRAFT}
    await R.generate_image(prompt="a brass diya", style="product_shot", org_id=ORG)
    for _model, sent in spy.calls:
        assert "seamless neutral sweep" in sent["prompt"]
        assert "garbled or misspelt text" in sent["prompt"]


async def test_all_providers_failing_still_raises(spy):
    spy.fail |= {DEV, SCHNELL, RECRAFT, FLUX2, LITE}
    with pytest.raises(RuntimeError, match="All image providers failed"):
        await R.generate_image(prompt="a brass diya", org_id=ORG)


# ── the retry, which is the difference between a hiccup and a bill ───────────

async def test_a_rate_limited_lead_is_asked_again_before_a_dearer_model_is(spy):
    """A 429 is not an answer, and the old ladder treated it as one.

    `_generate_openrouter_image` and `_generate_hf_image` raised the same bare
    `RuntimeError` for a 429 as for a 400, so a lead that was briefly throttled
    sent every image in that run to a model costing 60% more.
    """
    spy.fail |= {DEV}
    spy.raises[DEV] = R._ImageProviderError("429 rate limited", status=429)
    await R.generate_image(prompt="a brass diya", style="auto", org_id=ORG)
    assert _order(spy) == [DEV, DEV, SCHNELL], (
        "the same rung has to be asked twice before the ladder moves on"
    )


async def test_a_permanent_rejection_is_not_asked_twice(spy):
    """A 400 over an unsupported frame returns the same 400 in a second and a
    half. The retry exists for throttling, not for a round trip nobody needs."""
    spy.fail |= {DEV}
    spy.raises[DEV] = R._ImageProviderError(
        "aspect_ratio: not supported", status=400)
    await R.generate_image(prompt="a brass diya", style="auto", org_id=ORG)
    assert _order(spy) == [DEV, SCHNELL]


async def test_the_retry_gives_up_rather_than_looping(spy):
    """Two attempts, then the next rung. The customer is waiting on this."""
    spy.fail |= {DEV, SCHNELL}
    spy.raises[DEV] = R._ImageProviderError("503", status=503)
    spy.raises[SCHNELL] = R._ImageProviderError("503", status=503)
    result = await R.generate_image(prompt="a brass diya", style="auto", org_id=ORG)
    assert _order(spy) == [DEV, DEV, SCHNELL, SCHNELL, RECRAFT]
    assert result["model"] == RECRAFT


# ── the money on the rungs that did not win ──────────────────────────────────

async def test_a_billed_rung_that_lost_the_picture_still_reaches_the_ledger(spy, monkeypatch):
    """fal bills the megapixel at generation, not at download.

    So a 200 with a URL that then fails to fetch is a picture already paid for,
    and the ladder's answer is to buy another one. Only the WINNER was written
    to `hub_ai_logs`, which made the ladder's whole cost — on the product's
    largest line of AI spend — invisible in the report it is reconciled against.
    """
    rows = []

    async def _record(pool, **kw):
        rows.append(kw)

    monkeypatch.setattr(R, "_record_billed_failure", _record)
    spy.fail |= {DEV}
    spy.raises[DEV] = R._ImageProviderError(
        "generated an image that could not be fetched", cost_usd=0.025,
        provider="huggingface", model=DEV)

    result = await R.generate_image(prompt="a brass diya", style="auto", org_id=ORG)

    assert [r["cost_usd"] for r in rows] == [0.025]
    assert rows[0]["provider"] == "huggingface" and rows[0]["model"] == DEV
    assert rows[0]["org_id"] == ORG
    assert result["cost_usd"] == R._FAL_ROUTES["fal_flux_schnell"][2], (
        "the winning row still reports only what the winner cost; the rest of "
        "the spend is the row above"
    )


async def test_a_rung_that_failed_before_it_billed_writes_no_cost_row(spy, monkeypatch):
    """A 400 or a dead route costs a round trip and nothing else. A row with a
    price on it would overstate the bill in a report Aekam sets prices from."""
    rows = []

    async def _record(pool, **kw):
        rows.append(kw)

    monkeypatch.setattr(R, "_record_billed_failure", _record)
    spy.fail |= {DEV}
    await R.generate_image(prompt="a brass diya", style="auto", org_id=ORG)
    assert rows == []


# ── the frame reaching the model, end to end ─────────────────────────────────

async def test_the_preset_chooses_the_frame_when_the_caller_names_none(spy):
    """`quick_generate` passes no ratio, so every image it ever made was square.
    A blog hero is 16:9 whether or not the route remembered to say so."""
    await R.generate_image(prompt="an article about GST", style="blog_hero", org_id=ORG)
    assert dict(spy.calls)[DEV]["w"] > dict(spy.calls)[DEV]["h"]


async def test_a_caller_that_names_a_frame_still_wins(spy):
    await R.generate_image(prompt="an article about GST", style="blog_hero",
                           aspect_ratio="9:16", org_id=ORG)
    call = dict(spy.calls)[DEV]
    assert call["h"] > call["w"]


async def test_the_pixel_dimensions_reach_the_one_provider_that_takes_them(spy):
    await R.generate_image(prompt="x", style="auto", aspect_ratio="16:9", org_id=ORG)
    call = dict(spy.calls)[DEV]
    assert (call["w"], call["h"]) == R._ASPECT_DIMS["16:9"]


# ══════════════════════════════════════════════════════════════════════════════
# 5 · WHAT COMES BACK, AND WHAT IS STORED
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_webp_is_not_filed_as_a_png(monkeypatch, spy):
    """Only FLUX.2 Pro returns PNG. Recraft answers WebP and Gemini answers
    JPEG, and all three were being written as `srijan-xxxx.png` with
    `content_type="image/png"` — an extension, a content type and a body that
    all disagree."""
    monkeypatch.setattr(R, "_generate_openrouter_image",
                        spy.openrouter({RECRAFT: "image/webp"}))
    spy.fail |= {DEV, SCHNELL}
    result = await R.generate_image(prompt="Diwali card", style="festival_greeting", org_id=ORG)
    upload = spy.uploads[0]
    assert upload["filename"].endswith(".webp")
    assert upload["content_type"] == "image/webp"
    assert result["mime"] == "image/webp"


async def test_the_key_is_returned_beside_the_url(spy):
    """The presigned URL dies in nine hours; the key is what re-signs it."""
    result = await R.generate_image(prompt="x", org_id=ORG)
    assert result["image_key"] == "srijan/images/x"
    assert "image_bytes" not in result, "raw bytes must not travel back to the caller"


# ══════════════════════════════════════════════════════════════════════════════
# 6 · FETCHING THE PICTURE — the step that is new, and the one that can hurt
# ══════════════════════════════════════════════════════════════════════════════
#
# The fal route hands back a URL rather than bytes. `httpx.get(url)` would buy
# whatever is at the other end before anything could refuse it, which is the
# same class of bug as the 500 MB e-sign POST that was resident in the worker
# before a 20 MB check rejected it.


class _FakeStream:
    def __init__(self, chunks, headers, status=200):
        self._chunks, self.headers, self.status_code = chunks, headers, status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    async def aiter_bytes(self, size):
        for c in self._chunks:
            yield c


class _FakeClient:
    def __init__(self, stream):
        self._stream = stream

    def __call__(self, *a, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def stream(self, method, url):
        self._stream.requested = url
        return self._stream


def _serve(monkeypatch, chunks, headers):
    stream = _FakeStream(chunks, headers)
    monkeypatch.setattr(R.httpx, "AsyncClient", _FakeClient(stream))
    return stream


@pytest.mark.parametrize("url", [
    "http://v3b.fal.media/files/b/x.png",          # not https
    "https://169.254.169.254/latest/meta-data/",   # link-local
    "https://fal.media.evil.test/x.png",           # suffix that is not the host
    "https://example.invalid/x.png",
])
async def test_the_fetch_only_ever_goes_to_fal(monkeypatch, url):
    """The URL arrives inside a provider's JSON body, which makes it
    provider-controlled input. Restricting the host costs nothing and means a
    confused response cannot point this server at an arbitrary address."""
    _serve(monkeypatch, [b"x"], {"content-type": "image/png"})
    with pytest.raises(RuntimeError, match="refusing to fetch"):
        await R._download_image_capped(url)


async def test_the_observed_host_is_allowed(monkeypatch):
    """`v3b.fal.media`, measured 2026-08-19. If this goes red fal has moved its
    CDN and `_FAL_HOSTS` is the one-line fix."""
    _serve(monkeypatch, [b"PNGDATA"], {"content-type": "image/png"})
    body, mime = await R._download_image_capped("https://v3b.fal.media/files/b/x.png")
    assert body == b"PNGDATA" and mime == "image/png"


async def test_an_oversize_body_is_abandoned_mid_download(monkeypatch):
    """Refused before it is all in memory, not after. There are two gunicorn
    workers on a 2 GB container."""
    chunk = b"\0" * (1024 * 1024)
    huge = [chunk] * (R._MAX_IMAGE_BYTES // len(chunk) + 4)
    _serve(monkeypatch, huge, {"content-type": "image/png"})
    with pytest.raises(RuntimeError, match="exceeded the size cap"):
        await R._download_image_capped("https://v3b.fal.media/files/b/x.png")


async def test_a_declared_oversize_length_is_refused_before_a_single_byte(monkeypatch):
    stream = _serve(monkeypatch, [b"x"], {
        "content-type": "image/png",
        "content-length": str(R._MAX_IMAGE_BYTES + 1),
    })
    with pytest.raises(RuntimeError, match="declares"):
        await R._download_image_capped("https://v3b.fal.media/files/b/x.png")
    assert stream.requested.endswith("x.png")


async def test_a_missing_content_length_is_not_treated_as_zero(monkeypatch):
    """Chunked responses declare nothing. The cap still applies to the stream."""
    _serve(monkeypatch, [b"abc"], {"content-type": "image/webp"})
    body, mime = await R._download_image_capped("https://fal.media/x.webp")
    assert body == b"abc" and mime == "image/webp"


# ══════════════════════════════════════════════════════════════════════════════
# 7 · THE PROVIDER STRING IS A RECONCILIATION KEY, NOT A LABEL
# ══════════════════════════════════════════════════════════════════════════════

class _FakePost:
    def __init__(self, payload, status=200, text=""):
        self._payload = payload
        self.status_code = status
        self.text = text
        self.sent = None

    def __call__(self, *a, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self.sent = {"url": url, "json": json}
        return self

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


async def test_the_lead_still_reports_into_the_huggingface_bucket(monkeypatch):
    """`routers/admin_orgs.py::provider_costs` reconciles with
    `tracked_ai.get("huggingface", 0)` — an exact string match. Renaming the
    provider code would drop the ladder's LEAD, and so most of the product's
    image spend, out of the only bucket it is checked against."""
    fake = _FakePost({"images": [{"url": "https://v3b.fal.media/files/b/x.png",
                                 "content_type": "image/png"}]})
    monkeypatch.setattr(R.httpx, "AsyncClient", fake)

    async def _dl(url):
        return b"PNG", "image/png"

    monkeypatch.setattr(R, "_download_image_capped", _dl)

    out = await R._generate_hf_image("k", "a brief", 1344, 768)
    assert out["provider"] == "huggingface"
    assert "fal-ai" in out["model"], "the route belongs in the model, not the bucket"
    assert out["cost_usd"] > 0, (
        "a zero here has the spend report call the cheapest step free, which is "
        "how images came to be 79% of the AI bill without anyone seeing it"
    )


async def test_the_snapped_frame_is_what_leaves_the_process(monkeypatch):
    """The assertion that would have caught the live 400: what goes on the wire.

    Snapping in `_generate_openrouter_image` rather than in `generate_image`
    means every caller of the helper is covered, and it means this is the only
    place the outgoing body can be checked.
    """
    fake = _FakePost({"data": [{"b64_json": "AAAA", "media_type": "image/png"}]})
    monkeypatch.setattr(R.httpx, "AsyncClient", fake)

    await R._generate_openrouter_image("k", "a brief", "4:5", "recraft/recraft-v4")
    assert fake.sent["json"]["aspect_ratio"] == "3:4"
    assert fake.sent["json"]["aspect_ratio"] in R._OPENROUTER_RATIOS
    assert "negative_prompt" not in fake.sent["json"]


async def test_a_rejection_carries_the_reason_and_not_just_the_status(monkeypatch):
    """OpenRouter puts the whole reason in the body — "aspect_ratio: not
    supported. Accepted: 1:1, 4:3, 3:4, 16:9, 9:16" — and `raise_for_status()`
    threw it away. A bare 410 in the log above a rung that had silently stopped
    answering is how the HuggingFace step stayed dead for weeks."""
    fake = _FakePost({}, status=400, text='{"error":{"message":"aspect_ratio: not supported"}}')
    monkeypatch.setattr(R.httpx, "AsyncClient", fake)

    with pytest.raises(RuntimeError, match="aspect_ratio: not supported"):
        await R._generate_openrouter_image("k", "a brief", "1:1", "recraft/recraft-v4")


async def test_the_dead_provider_route_is_not_the_one_being_called(monkeypatch):
    """`hf-inference` answers 410 Gone — "the requested model is deprecated and
    no longer supported by provider hf-inference" — for every image model on
    this key. That dead step is why the lite model became the default."""
    fake = _FakePost({"images": [{"url": "https://v3b.fal.media/files/b/x.png"}]})
    monkeypatch.setattr(R.httpx, "AsyncClient", fake)

    async def _dl(url):
        return b"PNG", "image/png"

    monkeypatch.setattr(R, "_download_image_capped", _dl)

    await R._generate_hf_image("k", "a brief", 1024, 1024)
    assert "hf-inference" not in fake.sent["url"]
    assert fake.sent["url"].startswith("https://router.huggingface.co/fal-ai/")
    # And the frame travels as real pixels, which is the only reason this rung
    # leads: it is the one provider that takes dimensions rather than a hint.
    assert fake.sent["json"]["image_size"] == {"width": 1024, "height": 1024}


@pytest.mark.parametrize("step", sorted(R._FAL_ROUTES))
async def test_both_fal_routes_are_the_same_request_to_a_different_path(monkeypatch, step):
    """One function, two routes. A second copy is a second place for the
    header, the frame and the download cap to drift apart."""
    fake = _FakePost({"images": [{"url": "https://v3b.fal.media/files/b/x.png"}]})
    monkeypatch.setattr(R.httpx, "AsyncClient", fake)

    async def _dl(url):
        return b"PNG", "image/png"

    monkeypatch.setattr(R, "_download_image_capped", _dl)

    path, model, price = R._FAL_ROUTES[step]
    out = await R._generate_hf_image("k", "a brief", 1024, 1024, step=step)
    assert fake.sent["url"] == f"https://router.huggingface.co/{path}"
    assert out["model"] == model and out["cost_usd"] == price
    assert out["provider"] == "huggingface", (
        "both routes reconcile into the bucket `provider_costs` reads by exact "
        "string; the route belongs in the model"
    )


# ── the picture that was paid for and then dropped ───────────────────────────
#
# fal bills the megapixel at generation. Everything after the 200 is a picture
# already bought, so a fetch that fails costs the price of the image AND sends
# the ladder off to buy a second one.


class _Flaky:
    def __init__(self, fails):
        self.fails = list(fails)
        self.attempts = 0

    async def __call__(self, url):
        self.attempts += 1
        if self.fails:
            raise self.fails.pop(0)
        return b"PNG", "image/png"


async def _hf_with(monkeypatch, downloader):
    fake = _FakePost({"images": [{"url": "https://v3b.fal.media/files/b/x.png"}]})
    monkeypatch.setattr(R.httpx, "AsyncClient", fake)
    monkeypatch.setattr(R, "_download_image_capped", downloader)
    monkeypatch.setattr(R, "_IMAGE_RETRY_DELAY_S", 0)


async def test_an_image_already_paid_for_is_fetched_again_before_it_is_abandoned(monkeypatch):
    """A transient 5xx from the CDN is not a reason to buy a second picture."""
    dl = _Flaky([httpx.ConnectError("connection reset")])
    await _hf_with(monkeypatch, dl)
    out = await R._generate_hf_image("k", "a brief", 1024, 1024)
    assert dl.attempts == 2 and out["image_bytes"] == b"PNG"


async def test_a_fetch_the_size_cap_refused_is_not_refetched(monkeypatch):
    """The cap returns the same answer however many times it is asked, and the
    body it is refusing is the expensive part of asking."""
    dl = _Flaky([RuntimeError("generated image exceeded the size cap mid-download"),
                 RuntimeError("generated image exceeded the size cap mid-download")])
    await _hf_with(monkeypatch, dl)
    with pytest.raises(R._ImageProviderError):
        await R._generate_hf_image("k", "a brief", 1024, 1024)
    assert dl.attempts == 1


async def test_a_lost_picture_carries_its_price_out_with_it(monkeypatch):
    """The only way that spend reaches `hub_ai_logs`: the success row after the
    ladder records the winner alone, so a rung billed for a picture nobody
    received was money the report could not see."""
    dl = _Flaky([RuntimeError("generated image declares 99999999 bytes")] * 2)
    await _hf_with(monkeypatch, dl)
    with pytest.raises(R._ImageProviderError) as exc:
        await R._generate_hf_image("k", "a brief", 1024, 1024, step="fal_flux_dev")
    assert exc.value.cost_usd == R._FAL_ROUTES["fal_flux_dev"][2]
    assert exc.value.provider == "huggingface"


def test_a_rejection_before_the_generation_carries_no_price(monkeypatch):
    """A 400 or a 410 costs a round trip and nothing else. A price on that row
    would overstate a bill Aekam sets its own prices from."""
    assert R._ImageProviderError("410 Gone", status=410).cost_usd == 0.0


@pytest.mark.parametrize("exc, retry", [
    (R._ImageProviderError("throttled", status=429), True),
    (R._ImageProviderError("gateway", status=503), True),
    (R._ImageProviderError("aspect_ratio: not supported", status=400), False),
    (R._ImageProviderError("deprecated route", status=410), False),
    (httpx.ConnectError("reset"), True),
    (RuntimeError("generated image exceeded the size cap mid-download"), False),
])
def test_only_the_failures_that_can_change_their_mind_are_retried(exc, retry):
    assert R._is_transient(exc) is retry


# ══════════════════════════════════════════════════════════════════════════════
# 8 · THE FALLBACK NOBODY CALLS YET, AND THE COMMENT THAT LIED ABOUT IT
# ══════════════════════════════════════════════════════════════════════════════
#
# `generate_rich_content` is imported by `routers/hub.py` and called from no
# route today. Its separate-text-then-image fallback carried a comment claiming
# `generate_image` builds the brief — subject, composition, lighting, palette
# and negatives. It does not: it adds the frame, the lettering rule, the finish
# and the negatives to whatever it is handed, and a subject it was never given
# is a subject nobody supplied. The string being handed over was the prompt
# written for the LANGUAGE model.


async def test_the_rich_fallback_briefs_the_picture_instead_of_reusing_the_copy_brief(
        monkeypatch):
    """The text prompt is full of instructions an image encoder cannot use.

    "300 words for LinkedIn. Professional tone, brand values, and festival
    relevance" is migration 012's own template text, and it was the ONLY thing
    the image model was told — a picture with no subject, no setting, no light
    and no palette, which is the definition of the slop this path exists to end.

    What is NOT asserted here is that the customer's own words are edited out of
    the brief. They lead the subject line by design: the owner asked for the
    description of the skill to reach the model, and cutting the customer's
    sentence down is the same instinct that produced `prompt[:200]`. The fix is
    that the sentence is no longer alone.
    """
    text_prompt = ("Write a 300-word Diwali post for LinkedIn. Professional tone, "
                   "brand values, and festival relevance. End with three hashtags.")
    seen = {}

    fake = _FakePost({})                    # no "choices" — the rich model fails
    monkeypatch.setattr(R.httpx, "AsyncClient", fake)

    async def _generate(**kw):
        return {"text": "Diwali post copy", "provider": "openrouter",
                "model": "x", "prompt_tokens": 1, "completion_tokens": 2,
                "cost_usd": 0.0}

    async def _image(prompt, style="auto", aspect_ratio=None, org_id=None):
        seen.update(prompt=prompt, style=style)
        return {"image_url": "https://r2.invalid/x", "image_key": "k",
                "mime": "image/png", "cost_usd": 0.025}

    monkeypatch.setattr(R, "generate", _generate)
    monkeypatch.setattr(R, "generate_image", _image)

    out = await R.generate_rich_content(prompt=text_prompt, org_id=ORG)

    assert out["images"], "the fallback still has to produce a picture"
    assert seen["prompt"] != text_prompt, (
        "the copy brief was handed to the image model unchanged — the defect "
        "the comment above this test claimed was already fixed"
    )
    assert R._is_art_directed(" ".join(seen["prompt"].split())), (
        "the picture arrived without a subject, setting, light or palette"
    )
    for slot in ("Subject:", "Composition:"):
        assert slot in seen["prompt"], f"no {slot} reached the image model"
    assert R._resolve_preset(seen["style"])[0] in R._IMAGE_PRESETS


# ══════════════════════════════════════════════════════════════════════════════
# 9 · THE INLINE-IMAGE BRANCH, WHICH HAD NEVER ONCE BEEN EXECUTED
# ══════════════════════════════════════════════════════════════════════════════
#
# Section 8 above exercises `generate_rich_content`'s FALLBACK — the path taken
# when the rich model returns no `choices`. The path taken when it SUCCEEDS and
# hands back a `data:` image was covered by nothing at all, and it did not work:
# it read `user_id`, which was not a parameter of the function, not a global,
# and not a local. `NameError: name 'user_id' is not defined`, on the first line
# that touched the picture it had just been given.
#
# It has never been seen because `routers/hub.py` imports the function and no
# route calls it. That is a reprieve, not a defence — Phase 6's own rule is that
# a writer ships with a test that actually executes it, and this is the same
# failure in a different coat: code that reads correctly and has never run.
#
# The test below runs the branch end to end with a real one-pixel PNG. It fails
# with the NameError against the previous signature.


def _one_pixel_png_data_uri() -> str:
    """A real PNG, base64'd into a data: URI the way OpenRouter returns one.

    Built here rather than read from a fixture so the test owns its own input —
    the same reason `_helpers.makePdf` exists on the frontend side.
    """
    import base64
    png = bytes([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82,
    ])
    return "data:image/png;base64," + base64.b64encode(png).decode()


async def test_the_rich_model_can_actually_return_an_inline_image(monkeypatch):
    """The success path stores the picture and says who it belongs to.

    Three things are asserted, and the first is the one that was broken:

      1 · IT RUNS. Against the old signature this raises NameError before the
          upload is ever attempted.
      2 · The bytes that reach storage are the DECODED png, not the data URI —
          a base64 string written into a bucket is a file nothing can open.
      3 · `user_id` arrives as given. Not "system", which was never true of
          anybody, and not the org id, which is not a person.
    """
    seen = {}

    async def _upload(**kw):
        seen.update(kw)
        return {"url": "https://r2.invalid/inline.png", "key": "k"}

    import services.storage as storage_mod
    monkeypatch.setattr(storage_mod, "upload_file", _upload)

    payload = {
        "choices": [{"message": {"content": [
            {"type": "text", "text": "Here is your Diwali post."},
            {"type": "image_url",
             "image_url": {"url": _one_pixel_png_data_uri()}},
        ]}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20, "cost": 0.01},
    }
    monkeypatch.setattr(R.httpx, "AsyncClient", _FakePost(payload))

    async def _pool():
        class _P:
            async def execute(self, *a, **kw):
                return None
        return _P()
    monkeypatch.setattr(R, "get_pool", _pool)

    out = await R.generate_rich_content(
        prompt="A Diwali post", org_id=ORG, user_id="user_abc123")

    assert out["images"], "the inline image was dropped on the floor"
    assert out["images"][0]["url"] == "https://r2.invalid/inline.png"
    assert out["text"] == "Here is your Diwali post."

    assert seen["file_bytes"][:8] == bytes([0x89, 0x50, 0x4E, 0x47,
                                            0x0D, 0x0A, 0x1A, 0x0A]), (
        "the data: URI was stored as text instead of being decoded — the bucket "
        "would hold a base64 string with a .png name on it"
    )
    assert seen["user_id"] == "user_abc123", (
        "the picture was stored without the owner the caller named"
    )
    assert seen["org_id"] == ORG


def test_generate_rich_content_declares_every_name_its_body_reads():
    """The general form of the bug above, held open.

    `generate_rich_content` read `user_id` while having no such parameter for
    long enough to ship. A signature check is cheap and catches the next one
    before a route reaches it — which is the whole difference between this and
    a defect that waits for a customer to find it.
    """
    sig = inspect.signature(R.generate_rich_content)
    for name in ("prompt", "org_id", "user_id"):
        assert name in sig.parameters, (
            f"`generate_rich_content` body reads `{name}` but does not take it"
        )
    assert sig.parameters["user_id"].default == "", (
        "an unowned upload must default to unset, never to a stand-in owner"
    )
