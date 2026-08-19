"""
image_brief.py — the art direction between a skill and an image model.

── The measurement that forced this file ────────────────────────────────────

Every picture this product has ever made was asked for like this:

    generate_image(prompt="Create a professional image for: " + prompt[:200])

Two faults in one line, and together they are the whole of the slop:

  · THE BRIEF WAS CUT AT 200 CHARACTERS, mid-word, behind a fixed prefix. The
    skill description — the thing the owner asked to be drawn, "detailed image
    by description of skill" — was discarded from the second sentence onward.
  · NO SUBJECT, SETTING, FRAMING, LIGHT, PALETTE OR NEGATIVE ever reached the
    model. "Professional" is not a picture. A diffusion model resolves it to
    the mean of its training set, and the mean of the training set is exactly
    what people mean when they say an image looks AI-generated.

The price tier was never the fault. Measured 2026-08-19 over live spend: the
lite image model costs $0.036 a call (37 calls, $1.3256) and the premium one
$0.040 (10 calls, $0.40) — the same money, and 79% of every rupee this product
has ever spent on AI. What the cheaper model cannot do is invent a composition
nobody described. So the spend goes on the BRIEF instead: one text call of a
few hundred tokens against a four-cent image is a rounding error, and it is the
largest quality lever available. A well-briefed cheap model beats a badly
briefed expensive one, and only one of those two is affordable at a flat INR
subscription where Aekam absorbs the cost.

── Why the art direction lives in CODE ──────────────────────────────────────

There are nineteen rows in `staging.hub_skill_templates` and they are three
different pictures at least: a Diwali greeting, a GSTR-3B due-date brief and a
product-launch pack must not share one look, and until today they shared one
prefix and nothing else. The direction for each is here, keyed by template, because
staging and production share one Supabase database and this agent may not write
to it. Falling back by CATEGORY and then to a house default is what makes a
template added tomorrow still arrive with a real brief rather than with
nothing — the failure this file exists to end.

Per-org branding overlays on top and comes from `hub_org_skills.custom_config`,
the jsonb column that already exists for org-level overrides (it is read at
`routers/hub.py:run_org_skill` and merged into the step variables). The
override keys are the FIELD NAMES of `ArtDirection`, one per line of the brief,
so the admin screen Aekam will eventually author these in is one form with one
input per slot and no mapping layer in between.

── The expansion call fails SAFE ────────────────────────────────────────────

`build_brief` asks the cheap text model to turn the house direction plus the
customer's brief into a concrete one. If that call fails — no key, provider
down, unparseable answer, a field that came back as slop vocabulary — the
result is the DETERMINISTIC brief from `compose_brief`, never the old truncated
string. `source` on the returned object says which of the two the caller got,
and the caller stores it, because until now nobody could look at a bad picture
and find out what the model was actually asked for.

── The handoff to `generate_image`, and where the seam is ───────────────────

This module decides WHAT the picture is of; `ai_router` decides how it is made.
Two facts cross that seam and both are read rather than restated, so neither
side can drift without the build saying so:

  · `style` is a preset NAME from `ai_router._IMAGE_PRESETS`. It selects the
    ladder, the default frame and the lettering rule downstream, and it used to
    be an argument nothing read at all.
  · `_SUBJECT_LIMIT` is how much of this prompt the router forwards before it
    appends its own preset direction. `compose_brief` fits inside it by
    dropping WHOLE lines, worst-loss-last, rather than letting the router slice
    the tail off — which would be this file's own defect, one layer down.

── No `-latest`, no Anthropic, no network in the test suite ─────────────────

The expansion runs through `services.ai_router.generate`, which is where model
selection already lives and where the spend is already logged. It is skipped
outright unless an OpenRouter or Groq key is present, so the offline suite
composes deterministically and calls nothing.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, fields as _fields, replace
from typing import Mapping, Optional, Sequence

log = logging.getLogger(__name__)


# ── Budgets ──────────────────────────────────────────────────────────────────

#: How much of the customer's own brief reaches the model. Generous on purpose:
#: the old code stopped at 200 characters and the owner's complaint was exactly
#: that. Nothing is ever cut mid-word — `condense` drops whole trailing
#: sentences, then whole words, and only then admits it with an ellipsis.
SUBJECT_BUDGET = 1200

#: The expansion is one short structured answer, not prose. 420 tokens is about
#: eight sentences, which is one per slot with room to spare.
EXPANSION_MAX_TOKENS = 420

#: A slow expansion must never hold up the picture. Past this the house brief
#: is used and the image is generated anyway.
EXPANSION_TIMEOUT_S = 20.0

#: The `style` values `generate_image` understands — the preset names in
#: `ai_router._IMAGE_PRESETS`, which choose the ladder, the frame and the
#: lettering rule downstream. Named here rather than imported, because importing
#: `ai_router` at module scope is a cycle; the ratchet that catches drift is
#: `test_every_style_this_module_emits_resolves_downstream`, which imports it.
#:
#: A token the router does not recognise degrades to `auto` by ITS contract, not
#: by luck — `_resolve_preset` falls back rather than raising, on the same
#: reasoning as everything else on this path: an un-specialised picture beats a
#: 500 on a route the customer has already been charged for.
STYLE_TOKENS = frozenset({
    "auto", "festival_greeting", "service_explainer", "team_card",
    "product_shot", "blog_hero",
})


def _downstream_budget() -> Optional[int]:
    """How much of this prompt `generate_image` will actually forward.

    `ai_router._build_image_prompt` slices the caller's brief at
    `_SUBJECT_LIMIT` before wrapping it in the preset's own direction — the T5
    encoder in the FLUX ladder tops out at 512 tokens and the scaffolding takes
    most of them. A brief composed here without knowing that number gets its
    tail cut off at the router instead, which is the same defect this file was
    written to remove, one layer down.

    So the limit is READ rather than restated: if it moves, this follows. If the
    attribute is not there at all, nothing is trimmed and the router's own slice
    is the only limit — which is no worse than today.
    """
    try:
        from services import ai_router
    except Exception:                                    # pragma: no cover
        return None
    limit = getattr(ai_router, "_SUBJECT_LIMIT", None)
    return limit if isinstance(limit, int) and limit > 0 else None


# ── The vocabulary that produces the mean of the training set ────────────────
#
# These words carry no visual information. "Professional, high quality, 4k,
# trending" describes nothing a camera or a hand could do differently, so the
# model falls back on its average, and its average is the look being complained
# about. Structure beats adjectives: a focal length, a light direction and a
# named colour change the picture; "stunning" does not.
#
# The list is used in two places and NEITHER of them is the image prompt. It is
# an instruction to the TEXT model during expansion, and it is the ratchet in
# `tests/test_skill_image_brief.py` that fails the build if any of them ever
# reaches a built prompt — including from a model expansion, which is why
# `_reject_slop` falls back per FIELD rather than discarding the whole answer.
SLOP_WORDS: tuple[str, ...] = (
    "professional", "high quality", "high-quality", "best quality", "4k", "8k",
    "uhd", "hd", "trending", "artstation", "masterpiece", "award winning",
    "award-winning", "ultra detailed", "ultra-detailed", "highly detailed",
    "intricate", "hyperrealistic", "photorealistic", "stunning", "beautiful",
    "gorgeous", "amazing", "epic", "breathtaking", "eye-catching",
    "scroll-stopping", "cinematic lighting", "vibrant colors",
    "vibrant colours", "modern and clean", "brand-quality",
)

_SLOP_RE = re.compile(
    r"(?<![\w-])(" + "|".join(re.escape(w) for w in SLOP_WORDS) + r")(?![\w-])",
    re.IGNORECASE,
)


# ── What every picture avoids, ordered by WHO ELSE SAYS IT ───────────────────
#
# Every entry here is still non-negotiable; the order is which one survives when
# the budget can only carry some of them, and that is decided by whether
# anything else on the path states the same thing.
#
# The stock-photo clichés lead because they are the whole of the complaint: they
# are what the mean of the training set looks like for a business prompt — a
# handshake, a thumbs-up, four people pointing at a rising chart — and no other
# instruction on this path mentions them. The glowing-blue-circuitry line is
# second because "AI" in a prompt summons it unbidden and nothing else names it
# either. Lettering is third and NOT because it matters less: it is stated three
# more times downstream — `ai_router._GLOBAL_AVOID` bans nonsense lettering, and
# `_build_image_prompt`'s lettering rule bans drawn words on the typographic
# branch as well as the plain one. Diffusion models render text as
# plausible-looking gibberish, and a festival greeting with a garbled Devanagari
# blessing is worse than no picture at all; the caption is set over the image by
# the surface that publishes it, which is also the only way the copy stays
# editable after the credit has been spent.
#
# ── THREE ITEMS WERE REMOVED AND THE REST WERE SHORTENED ─────────────────────
# Measured 2026-08-19, after this list was first written: the eight-item version
# cost 633 characters for `festival-calendar` alone, `compose_brief` appended it
# LAST, and the budget therefore dropped it in 140 of 140 combinations —
# nineteen template directions and sixteen skill directions at brief lengths 0,
# 80, 200 and 385, including a brief of length ZERO. Every negative this module
# wrote reached no model at all, "depictions of any deity or religious figure"
# among them, while the router's own festival avoid said only "no deity depicted
# inaccurately". The list was so long that it guaranteed its own deletion.
#
# So the three the router already restates are gone rather than merely demoted:
# `_GLOBAL_AVOID` covers warped logos, watermarks and signatures; it covers
# extra or fused fingers, deformed hands and uncanny faces; and it covers
# blown-out HDR glow, with `product_shot` adding lens flare. Spending the budget
# to say those a second time is what left no room for the ones nobody else says.
HOUSE_AVOID: tuple[str, ...] = (
    "stock-photo clichés — handshakes, thumbs-up, teams pointing at a chart",
    "glowing blue circuitry, floating holographic dashboards, plastic 3D offices",
    "any lettering, words or numerals inside the frame",
    "a drawn border ruled around the edge of the frame",
    "collage or split panels",
)

#: The locale, as a whole line, for the prompts with room for it. The SHORT cue
#: — "in contemporary India" — is welded into the lead sentence instead, because
#: the lead is the one line no budget can drop and this note was being dropped
#: for every brief over sixty characters. Where a person, a garment, a street or
#: a piece of furniture appears at all it has to read as contemporary urban
#: India: the customers are Indian firms and the default the model reaches for
#: is a Western open-plan office.
LOCALE_NOTE = (
    "Any people, clothing, street or interior in frame must read as "
    "contemporary urban India, present day."
)


# ── The brief ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ArtDirection:
    """One picture's worth of decisions, one sentence per slot.

    The field names are the override keys in
    `hub_org_skills.custom_config["image_brief"]`, so the admin form Aekam will
    author these in maps one input to one line with nothing in between.
    """

    subject: str
    setting: str
    composition: str
    lighting: str
    palette: str
    medium: str
    register: str
    style: str = "photographic"
    #: The canvas this composition was written FOR, and only where it differs
    #: from the one the style's preset delivers. Measured 2026-08-19:
    #: `weekly-reel-scripts` asked for a "vertical frame, phone in the right
    #: third" on `product_shot`, which resolves to 1:1 downstream — a reel visual
    #: composed vertical and rendered square. A composition that names a shape
    #: the canvas does not have is not a shorter instruction, it is a
    #: contradictory one.
    #:
    #: `None` everywhere else, deliberately: `ai_router._IMAGE_PRESETS` picked
    #: its frames from a measurement of what each provider actually accepts, and
    #: a second set of numbers here would fight a measured one with a guess.
    frame: Optional[str] = None
    avoid: tuple[str, ...] = ()


#: The slots a model expansion or an org override is allowed to replace. `style`
#: and `frame` are separate — they are routing values, not sentences — and
#: `avoid` is additive rather than replaceable, so none of the three is here.
DIRECTION_SLOTS: tuple[str, ...] = (
    "subject", "setting", "composition", "lighting", "palette", "medium",
    "register",
)


@dataclass(frozen=True)
class ImageBrief:
    """What `generate_image` is asked for, and the receipt for asking it.

    `prompt` is stored beside the generated image by every call site. Before
    this existed a customer could report a bad picture and nobody — not Aekam,
    not the org — could find out what the model had been told.
    """

    prompt: str
    style: str
    #: `None` means the downstream preset chooses the frame, which is the usual
    #: case — only a caller that named a ratio, or a direction whose composition
    #: needs a canvas the preset does not give it, overrides that.
    aspect_ratio: Optional[str]
    art_key: str
    source: str            # "model" — expanded; "template" — composed here

    # THERE IS NO `negative` FIELD, and there was one until 2026-08-19. It held
    # "; ".join(avoid) and it was a dead argument in three places at once:
    # `generate_image` takes no negative parameter, `_build_image_prompt` sends
    # `negative_prompt` to nobody on purpose (FLUX.1 is guidance-distilled and
    # runs at CFG 1, so a negative prompt has no mechanism to act through), and
    # `as_metadata` did not persist it either. The negatives reach the model the
    # only way they can, as the `Avoid:` line inside `prompt`.

    def as_metadata(self) -> dict:
        """The diagnosable record, for `hub_content_items.metadata`.

        A jsonb column that already exists, because this agent may not add one:
        staging and production share a single database and the schema is
        owner-gated.
        """
        return {
            "image_prompt": self.prompt,
            "image_brief_source": self.source,
            "image_art_key": self.art_key,
            "image_style": self.style,
            "image_aspect_ratio": self.aspect_ratio,
        }


# ══════════════════════════════════════════════════════════════════════════════
# ART DIRECTION — one entry per template, then per skill, then per category
# ══════════════════════════════════════════════════════════════════════════════
#
# Keyed by a slug of the template NAME rather than by its uuid. The name is what
# the call site already has (`run_org_skill` selects `t.name as template_name`),
# and a uuid pinned in source is a value nobody reviewing this file can check
# against the catalogue it claims to describe.
#
# The house rule running through all nineteen: NAME AN OBJECT. A brief whose
# subject is a feeling ("success", "growth") has no subject, and the model
# supplies the four people pointing at the chart. Every subject below is a thing
# that could be put on a table and photographed.

_TEMPLATE_ART: dict[str, ArtDirection] = {

    # ── branding ─────────────────────────────────────────────────────────────
    "seo-blog-series": ArtDirection(
        subject="one tightly framed object that stands for the article's topic, "
                "resting alone on a plain surface",
        setting="a seamless studio tabletop, no office and no room behind it",
        composition="three-quarter view, subject in the left third, the right "
                    "half left empty for a headline; 50mm, camera at "
                    "table height",
        lighting="soft north-window daylight from camera-left, one weak fill, "
                 "shadows allowed to fall",
        palette="paper white and ink black with a single saturated accent",
        medium="editorial magazine photograph, shallow depth of field",
        register="considered and unhurried, the opening spread of a long read",
        style="blog_hero",
        avoid=("laptops with visible screens", "a writer at a desk",
               "open books fanned into a heart"),
    ),

    # ── engagement ───────────────────────────────────────────────────────────
    "new-lead-triage": ArtDirection(
        subject="a small stack of identical blank index cards with one card "
                "lifted clear of the rest and held between two fingers",
        setting="a plain oak desk, nothing else on it",
        composition="dead overhead flat lay, the stack low in frame, the top "
                    "third empty",
        lighting="even diffuse daylight, soft contact shadows under each card",
        palette="cool grey-blue throughout with warm ochre on the lifted card "
                "alone",
        medium="quiet documentary photograph",
        register="methodical, the moment before a decision",
        style="auto",
        avoid=("crowds of people", "funnels or arrows drawn in the air",
               "magnifying glasses"),
    ),
    "overdue-follow-up-chase": ArtDirection(
        subject="a desk calendar whose passed days are struck through in pencil, "
                "one corner of the page curling",
        setting="the edge of a working desk, a pencil laid across the gutter",
        composition="low three-quarter, calendar filling the right two-thirds, "
                    "the left kept clear; 35mm, close",
        lighting="late-afternoon side light, long shadows across the grid",
        palette="bleached paper, graphite grey, one dulled red on the struck days",
        medium="close documentary photograph, deep focus",
        register="overdue but recoverable — quiet pressure, not alarm",
        style="auto",
        avoid=("hourglasses", "melting clocks", "red alarm klaxons",
               "a person with their head in their hands"),
    ),
    "weekly-reel-scripts": ArtDirection(
        subject="a phone standing in a small tripod inside a ring light, screen "
                "dark and empty",
        setting="a near-black studio corner, the ring light the only object "
                "behind it",
        composition="vertical frame, phone in the right third, wide dark space "
                    "to the left; 85mm, chest height",
        lighting="hard ring-light key with magenta and cyan rim from behind",
        palette="near-black ground, magenta and cyan rims, one neutral highlight",
        medium="contemporary product photograph",
        register="kinetic and young, the second before recording starts",
        style="product_shot",
        # The one direction whose composition needs a canvas the preset does not
        # give it: `product_shot` is 1:1 and this is a REEL, so the vertical
        # frame the composition names was being rendered square.
        frame="9:16",
        avoid=("play-button icons", "waveform graphics", "a face to camera"),
    ),
    "weekly-social-media-pack": ArtDirection(
        subject="seven blank square cards laid in a grid, slightly overlapping "
                "at the corners",
        setting="a flat painted paper backdrop in a single colour",
        composition="dead overhead flat lay, grid centred with an even margin "
                    "on all four sides",
        lighting="flat even studio light, minimal shadow, no falloff",
        palette="two brand colours against warm white, nothing else",
        medium="graphic-design still life, crisp edges",
        register="organised and prepared — a week laid out before it starts",
        style="auto",
        avoid=("social platform logos", "notification bubbles",
               "phone mockups with UI on the screen"),
    ),

    # ── festival ─────────────────────────────────────────────────────────────
    #
    # No deity is depicted, ever. It is the customer's own festival and their
    # own faith; a diffusion model's guess at a face is a risk with no upside.
    # Motifs, light and materials carry the whole picture instead.
    "festival-calendar": ArtDirection(
        subject="lit clay diyas, marigold garlands and a brass thali arranged "
                "as a border around an empty centre",
        setting="a dark textured floor — rangoli powder and raw silk",
        # "square" until 2026-08-19, on a style that resolves to the 4:5 the
        # feed actually rewards — so the most-posted picture in the product was
        # composed for a canvas it was never going to be rendered on, and the
        # symmetrical border landed with uneven margins. The shape is named
        # without a number so it cannot drift from the preset again; the exact
        # frame reaches the model on the `Surface:` line.
        composition="symmetrical border framing an empty middle for the "
                    "greeting; dead overhead, upright frame",
        lighting="low-key, lit almost entirely by the diya flames, deep falloff "
                 "into the corners",
        palette="deep marigold, vermilion, brass and gold leaf on aubergine",
        medium="rich still-life photograph, fine grain",
        register="celebratory and warm, family rather than corporate",
        style="festival_greeting",
        avoid=("depictions of any deity or religious figure",
               "Western holiday motifs — pine, snow, gift bows",
               "clip-art fireworks and confetti"),
    ),

    # ── general · the operations briefs ──────────────────────────────────────
    #
    # Eleven of the nineteen are internal reading, not marketing. Their picture
    # is a document cover: paper, desk, restraint. What separates them from one
    # another is the OBJECT and the mood, and those are what is written below —
    # a payment run and a payroll variance are not the same picture even though
    # both are a sheet of paper on a desk.
    "account-brief": ArtDirection(
        subject="a slim closed folder with one printed sheet half drawn out of "
                "it, and the rim of a cup at the frame edge",
        setting="a polished meeting-room table before anyone has sat down",
        composition="overhead, folder in the right third, the left half empty; "
                    "slight angle to the table edge",
        lighting="soft overhead daylight from a large window, gentle gradient",
        palette="warm neutral paper and oak with one deep navy accent",
        medium="restrained editorial photograph",
        register="prepared and unhurried, the minute before a call",
        style="auto",
        avoid=("a person's face", "name badges", "visible client names"),
    ),
    "gstr-1-filing-readiness": ArtDirection(
        subject="a squared stack of printed invoices with one sheet pulled "
                "proud of the rest and a red pencil laid across it",
        setting="a bare desk with a steel ruler at the edge",
        composition="tight three-quarter, stack on the left, clear space right; "
                    "shallow focus falling off behind the pulled sheet",
        lighting="cool overhead office daylight, crisp edge shadows",
        palette="paper white, form-blue ruling, a single red",
        medium="close editorial photograph, deep detail in the paper texture",
        register="exacting and pre-flight — one thing is wrong and it has been "
                 "found",
        style="auto",
        avoid=("rupee symbols floating in the air", "coins or banknotes",
               "any readable form field"),
    ),
    "gstr-3b-liability-brief": ArtDirection(
        subject="a single sheet held flat by a brass paperweight, with a heavy "
                "horizontal rule where a total would sit",
        setting="a slate-grey desk, an analogue desk clock soft in the "
                "background",
        composition="low three-quarter at desk level, sheet centred, clock "
                    "blurred behind at the right; 85mm",
        lighting="one hard low key from camera-right, long shadow off the "
                 "paperweight",
        palette="slate, brass and off-white, nothing warm",
        medium="sober still-life photograph",
        register="final and dated — the figure is settled and the day is fixed",
        style="auto",
        avoid=("calendars with readable dates", "money", "calculators"),
    ),
    "monday-morning-brief": ArtDirection(
        subject="an open notebook on a blank page beside a cup with steam still "
                "rising",
        setting="a small office desk at the window, the room behind it dark",
        composition="low three-quarter into the light, notebook in the lower "
                    "left, the bright window upper right; 35mm",
        lighting="first sunrise raking flat across the desk, strong warm-cool "
                 "split",
        palette="amber sunrise against cool blue interior shadow",
        medium="documentary photograph, natural grain",
        register="calm and unbegun — the first quiet hour of the week",
        style="auto",
        avoid=("motivational slogans", "sunrise over mountains",
               "a person stretching at a laptop"),
    ),
    "my-desk-today": ArtDirection(
        subject="one person's short handwritten list, a capped pen across it, a "
                "phone lying face down",
        setting="a corner of a shared desk, close and personal",
        composition="tight overhead, objects off-centre to the lower right, "
                    "generous empty desk above",
        lighting="soft single-source daylight from the left, low contrast",
        palette="muted warm greys and a single worn blue",
        medium="intimate documentary photograph, shallow depth",
        register="quiet and singular — one person's day, not a team's",
        style="auto",
        avoid=("groups of people", "open-plan office rows",
               "readable handwriting"),
    ),
    "payables-payment-run": ArtDirection(
        subject="vendor bills held in a bulldog clip, oldest and most yellowed "
                "on top, the stack fanned by age",
        setting="a plain steel desk edge",
        composition="three-quarter close on the clip, stack running out of "
                    "frame to the right, empty left third",
        lighting="flat even light, no drama, every edge legible",
        palette="kraft brown and aged paper against brushed steel",
        medium="documentary photograph, deep focus",
        register="orderly and provisional — a proposal awaiting a signature",
        style="auto",
        avoid=("cash, banknotes or coins", "card terminals or payment gateways",
               "anything implying money has already moved"),
    ),
    "payroll-variance-review": ArtDirection(
        subject="two printed columns side by side on a desk with a fine steel "
                "rule laid down the gap between them",
        setting="a closed office desk, blinds drawn behind",
        composition="dead overhead, the two sheets filling the lower two-thirds, "
                    "clear space above",
        lighting="even diffuse light, no shadow across the ruling",
        palette="cool grey and white with one muted green and one muted red used "
                "sparingly",
        medium="clinical still-life photograph",
        register="comparative and discreet — this is somebody's pay",
        style="auto",
        avoid=("faces or name badges", "readable figures or payslip layouts",
               "money"),
    ),
    "pipeline-risk-review": ArtDirection(
        subject="a row of upright wooden dominoes with a single gap where one "
                "has already fallen flat",
        setting="a dark matte tabletop, nothing behind",
        composition="low eye-level along the row so it recedes, the gap in the "
                    "near third; 85mm, shallow",
        lighting="one raking key from camera-left, each domino throwing its own "
                 "shadow",
        palette="deep teal ground with one amber domino at the gap",
        medium="graphic still-life photograph",
        register="diagnostic with tension held back — a problem found early",
        style="product_shot",
        avoid=("sales funnels", "up-and-right arrows or line charts",
               "warning triangles"),
    ),
    "pre-run-payroll-readiness": ArtDirection(
        subject="a clipboard checklist with several boxes ticked and the last "
                "few still empty, a pen resting across it",
        setting="a clean white counter, nothing else in frame",
        composition="overhead, clipboard tilted slightly off square, one corner "
                    "cropped, empty counter to the left",
        lighting="bright even clinical light, minimal shadow",
        palette="clinical white and ink blue with one amber tick outstanding",
        medium="clean still-life photograph",
        register="pre-flight and unfinished — nearly ready, not yet ready",
        style="auto",
        avoid=("readable checklist text", "green ticks in a circle",
               "a person signing"),
    ),
    "receivables-chase-pack": ArtDirection(
        subject="a stack of sealed envelopes, the topmost franked and unopened, "
                "the paper yellowing further down the pile",
        setting="a wooden desktop beside a closed brass letter tray",
        composition="three-quarter close, stack in the left third, wide empty "
                    "right; 50mm, shallow",
        lighting="warm side light from a window, soft falloff into the pile",
        palette="aged paper cream and postal red on warm walnut",
        medium="documentary still-life photograph",
        register="firm and courteous — persistent, never threatening",
        style="auto",
        avoid=("red stamps reading anything", "pointing fingers",
               "debt-collector imagery", "money"),
    ),
    "weekly-project-status-brief": ArtDirection(
        subject="a wall of small blank cards in three columns with one card "
                "caught mid-move between columns",
        setting="a plain painted office wall",
        composition="straight on, slightly wide, the three columns filling the "
                    "frame with air above them; 35mm",
        lighting="soft frontal daylight, each card lifting a small shadow off "
                 "the wall",
        palette="soft slate wall with three muted card colours, no fourth",
        medium="documentary photograph, deep focus",
        register="factual and in motion — the week actually moved",
        style="auto",
        avoid=("Gantt charts", "software screenshots or UI",
               "readable card text"),
    ),

    # ── launch ───────────────────────────────────────────────────────────────
    "campaign-launch": ArtDirection(
        subject="a coordinated set of blank printed pieces — card, folded "
                "leaflet, envelope, sticker — fanned into an even arc",
        setting="a single-colour painted paper backdrop",
        composition="dead overhead hero, the arc centred with a wide even "
                    "margin all round",
        lighting="flat even studio light, crisp shadowless edges",
        palette="a bold two-colour scheme on warm white, nothing else",
        medium="design-portfolio still life",
        register="deliberate and coordinated — a plan, before it runs",
        style="product_shot",
        avoid=("rockets or launch pads", "confetti", "megaphones"),
    ),
    "product-launch-pack": ArtDirection(
        subject="one unbranded product form on a low plinth, alone",
        setting="a seamless white cyclorama",
        composition="centred low three-quarter, plinth in the lower third, "
                    "wide empty air above; 85mm",
        lighting="one large soft key from above-left, a single accent gel "
                 "raking the backdrop",
        palette="near-white throughout with one saturated accent on the "
                "backdrop",
        medium="studio product photograph",
        register="expectant and premium — the object before anyone has "
                 "touched it",
        style="product_shot",
        avoid=("rockets", "hands presenting the product", "confetti",
               "packaging with any printing on it"),
    ),
}


# ── Skills and agent types ───────────────────────────────────────────────────
#
# The other two call sites have no template. `/org/generate` knows an
# `agent_type`, `/org/quick-generate` knows a skill key; both name a kind of
# picture, and where the two names mean the same picture they share an entry.
_SKILL_ART: dict[str, ArtDirection] = {
    "social_post": ArtDirection(
        subject="one everyday object that stands for the topic, isolated and "
                "large in frame",
        setting="a single flat colour ground, no scene",
        composition="square, subject centred and cropped generously, deliberate "
                    "empty margin for a caption; 50mm straight on",
        lighting="one soft key from above-left with a bright fill, clean "
                 "separation from the ground",
        palette="one saturated ground colour against a neutral subject",
        medium="graphic product photograph, crisp edges",
        register="direct and legible at thumbnail size",
        style="auto",
        avoid=("phone mockups with UI", "social platform logos",
               "people looking at phones"),
    ),
    "ad_copy": ArtDirection(
        subject="a single hero object, one focal point and nothing competing "
                "with it",
        setting="a bold seamless ground in one colour",
        composition="subject in the lower two-thirds with clear space above for "
                    "a headline; low three-quarter, 85mm",
        lighting="strong key from camera-right with a hard rim separating the "
                 "subject from the ground",
        palette="one dominant saturated colour and one neutral, no third",
        medium="advertising product photograph",
        register="confident and singular — one claim, one object",
        style="product_shot",
        avoid=("starbursts and discount badges", "arrows pointing at things",
               "before-and-after splits"),
    ),
    "email_campaign": ArtDirection(
        subject="a small arrangement of two or three related objects on a "
                "surface, read left to right",
        setting="a plain desk or paper ground running the full width",
        composition="wide banner, subject held in the left third so the right "
                    "stays clear for the headline; overhead, level",
        lighting="soft even daylight across the whole width, no hotspot",
        palette="warm neutral ground with a single accent repeated twice",
        medium="clean editorial still life",
        register="calm and welcoming — the top of a letter",
        style="blog_hero",
        avoid=("envelope and @ symbols", "inbox screenshots",
               "people at laptops smiling"),
    ),
    "blog_post": _TEMPLATE_ART["seo-blog-series"],
    "whatsapp_broadcast": ArtDirection(
        subject="one large simple object filling most of the frame, readable at "
                "the size of a thumbnail",
        setting="a single flat high-contrast ground",
        composition="square, subject centred and very large, nothing in the "
                    "corners; straight on",
        lighting="flat frontal light, no shadow detail to lose at small sizes",
        palette="two colours only, at maximum contrast to each other",
        medium="bold graphic photograph",
        register="immediate — it has one second to be understood",
        style="auto",
        avoid=("fine detail or texture that disappears when small",
               "messaging app UI", "green chat bubbles"),
    ),
    "proposal": ArtDirection(
        subject="a bound document lying closed and square on a desk, a fountain "
                "pen beside it",
        setting="a dark wood table, one corner of a leather blotter visible",
        composition="overhead, document in the right half, the left kept empty; "
                    "slight rotation off square",
        lighting="warm directional light from the left, soft shadow off the "
                 "document edge",
        palette="deep walnut and cream paper with one dark ink accent",
        medium="restrained editorial photograph",
        register="serious and considered — work someone will sign",
        style="product_shot",
        avoid=("readable cover text", "handshakes", "stacks of contracts"),
    ),
    "festival_campaign": _TEMPLATE_ART["festival-calendar"],

    # Agent types, for `/org/generate`, which has no skill key. Four more are
    # aliases of the skill entries above and are added under `_SKILL_ALIASES`.
    "campaign": _TEMPLATE_ART["campaign-launch"],
    "seo": _TEMPLATE_ART["seo-blog-series"],
    "ad_analysis": ArtDirection(
        subject="a printed report folded open at one page, a highlighter cap "
                "off beside it",
        setting="a clean matte desk under a task lamp",
        composition="three-quarter close on the fold, page filling the right "
                    "two-thirds, empty left; 50mm",
        lighting="one soft task-lamp key from above-right, the rest falling "
                 "away",
        palette="cool paper white, graphite, a single highlighter yellow",
        medium="documentary still-life photograph",
        register="analytical and quiet — a finding, not a celebration",
        style="auto",
        avoid=("bar and line charts", "dashboards", "rising arrows"),
    ),
}

#: `agent_type` → the skill key that means the same picture. `/org/generate`
#: knows only the agent type, `/org/quick-generate` only the skill key, and the
#: two vocabularies overlap; stating the pairing once is what stops them drifting
#: into two different looks for one kind of content.
_SKILL_ALIASES: dict[str, str] = {
    "social_media": "social_post",
    "email": "email_campaign",
    "blog": "blog_post",
    "whatsapp": "whatsapp_broadcast",
    "lead_magnet": "proposal",
}
for _alias, _target in _SKILL_ALIASES.items():
    _SKILL_ART[_alias] = _SKILL_ART[_target]
del _alias, _target


# ── Categories ───────────────────────────────────────────────────────────────
#
# The floor. A template added to the catalogue tomorrow has no entry above, and
# the whole point of this file is that it must still arrive with a real brief
# rather than with a generic prefix. Its category is a column on the row, so
# there is always something to fall back TO.
_CATEGORY_ART: dict[str, ArtDirection] = {
    "branding": _TEMPLATE_ART["seo-blog-series"],
    "engagement": _TEMPLATE_ART["weekly-social-media-pack"],
    "festival": _TEMPLATE_ART["festival-calendar"],
    "general": _TEMPLATE_ART["account-brief"],
    "launch": _TEMPLATE_ART["campaign-launch"],
}

#: The last resort, and it is still a composition rather than an adjective.
DEFAULT_ART = ArtDirection(
    subject="one object drawn from the brief, alone and clearly lit",
    setting="a plain seamless ground with nothing behind the subject",
    composition="three-quarter view, subject in the left third, the right half "
                "left empty for copy; 50mm at subject height",
    lighting="one soft key from camera-left with a weak fill, shadows kept",
    palette="warm neutral ground with a single accent colour",
    medium="editorial still-life photograph, shallow depth of field",
    register="plain and unhurried",
    style="auto",
    avoid=(),
)


# ── Aspect ratio ─────────────────────────────────────────────────────────────
#
# THERE IS NO PLATFORM→RATIO TABLE HERE, and that is a decision rather than an
# omission. `generate_image` resolves the frame from the preset it was given —
# `blog_hero` is 16:9, `festival_greeting` is 4:5 — and those numbers came out
# of the same 2026-08-19 measurement that found OpenRouter validates
# `aspect_ratio` against a per-model allowlist and answers 400 rather than
# picking something near. A second table here would fight a measured one with a
# guess, which is how two sources of truth for one fact usually start.
#
# So: the caller's ratio if the caller named one, then the direction's own
# `frame` where the composition depends on a canvas the preset does not give it,
# and otherwise nothing — which lets the preset choose. The surface is still
# told to the model in words — the `Surface:` line in the composed prompt —
# because knowing it is Instagram changes the composition even when it does not
# change the frame.
#
# WHAT THE FRAME IS, IN WORDS, IS A SEPARATE QUESTION FROM WHO CHOOSES IT, and
# conflating the two is what made the expansion call read "Frame: None" on
# essentially every image: `quick_generate` names no ratio, so the art director
# was asked to compose for a canvas nobody had told it about. The number is
# knowable here — `_preset_ratio` reads it back out of the preset the style will
# resolve to — so it is stated even when this module is not the one choosing it.


# ══════════════════════════════════════════════════════════════════════════════
# Resolution
# ══════════════════════════════════════════════════════════════════════════════

def slug(name: Optional[str]) -> str:
    """`"GSTR-1 filing readiness"` → `"gstr-1-filing-readiness"`."""
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")


def art_direction_for(
    *,
    template_name: Optional[str] = None,
    skill: Optional[str] = None,
    agent_type: Optional[str] = None,
    category: Optional[str] = None,
) -> tuple[str, ArtDirection]:
    """Resolve the house direction, most specific source first.

    Template, then the skill or agent type, then the category, then the default.
    The key travels with the direction and is stored beside the image: when a
    picture is wrong, the first question is which of these four answered, and
    that is not recoverable from the prompt text alone.
    """
    key = slug(template_name)
    if key and key in _TEMPLATE_ART:
        return key, _TEMPLATE_ART[key]

    for candidate in (skill, agent_type):
        if candidate and candidate in _SKILL_ART:
            return candidate, _SKILL_ART[candidate]

    cat = (category or "").strip().lower()
    if cat in _CATEGORY_ART:
        return f"category:{cat}", _CATEGORY_ART[cat]

    return "default", DEFAULT_ART


def aspect_for(
    *,
    requested: Optional[str] = None,
    direction: Optional[ArtDirection] = None,
) -> Optional[str]:
    """The caller's frame, then the direction's, or `None` for the preset.

    Kept as a named function rather than inlined because the rule is the point:
    this module does not guess a ratio from a PLATFORM. See the block comment
    above. `direction.frame` is not a guess — it is set on the one direction
    whose composition names a shape the preset does not deliver.
    """
    return (requested or "").strip() or (direction.frame if direction else None)


def _preset_ratio(style: str) -> Optional[str]:
    """The frame `generate_image` will actually deliver for this style.

    Read, never restated — the same seam as `_downstream_budget` and for the
    same reason: `ai_router._IMAGE_PRESETS` is where the numbers were measured,
    and a copy of them here would drift silently the first time one moved.

    Only ever used to TELL the model and the art director what the canvas is.
    Nothing is chosen from it, so `None` — an ai_router that has moved its
    presets — costs a phrase in a prompt and never a wrong frame.
    """
    try:
        from services import ai_router
    except Exception:                                    # pragma: no cover
        return None
    resolve = getattr(ai_router, "_resolve_preset", None)
    if not callable(resolve):
        return None
    try:
        _name, preset = resolve(style)
        ratio = preset.get("ratio")
    except Exception:                                    # pragma: no cover
        return None
    return ratio.strip() if isinstance(ratio, str) and ratio.strip() else None


# ── Overrides: the org's own branding ────────────────────────────────────────

def apply_overrides(
    direction: ArtDirection, overrides: Optional[Mapping]
) -> ArtDirection:
    """Overlay `hub_org_skills.custom_config["image_brief"]` onto the house look.

    Slots are REPLACED and `avoid` is ADDED TO, because an org that wants to ban
    one more thing should not have to restate the seven house bans to keep them.
    Unknown keys are ignored rather than raising: this is customer-authored jsonb
    and a typo in it must not take a paid run down.
    """
    if not isinstance(overrides, Mapping) or not overrides:
        return direction

    patch: dict = {}
    for name in DIRECTION_SLOTS:
        value = overrides.get(name)
        if isinstance(value, str) and value.strip():
            patch[name] = value.strip()

    style = overrides.get("style")
    if isinstance(style, str) and style.strip().lower() in STYLE_TOKENS:
        patch["style"] = style.strip().lower()

    extra = overrides.get("avoid")
    if isinstance(extra, str) and extra.strip():
        extra = [extra]
    if isinstance(extra, Sequence) and not isinstance(extra, (str, bytes)):
        added = tuple(str(x).strip() for x in extra if str(x).strip())
        if added:
            patch["avoid"] = tuple(direction.avoid) + added

    return replace(direction, **patch) if patch else direction


def brand_colours(brand: Optional[Mapping]) -> list[str]:
    """The org's own colours, if it has set any.

    Separated from the rest of the brand row because it does not ADD a line —
    it REPLACES the house `Colour:` line. The two were emitted one after the
    other, so a budget that dropped the brand line left the house palette
    standing on its own, contradicting the palette the org had paid to set; and
    a budget that kept both handed the encoder two palettes to average. One slot
    means neither can happen, and it costs one line rather than two.
    """
    if not isinstance(brand, Mapping) or not brand:
        return []
    return [
        str(brand.get(k)).strip()
        for k in ("color_primary", "color_secondary", "color_accent")
        if brand.get(k) and str(brand.get(k)).strip()
    ]


def brand_notes(brand: Optional[Mapping]) -> list[str]:
    """The rest of the brand row, as lines a picture can actually obey.

    Colours and the do-not list are the only parts of `hub_brand_profiles` that
    change a photograph; brand voice and sample posts change the copy and are
    already in the TEXT system prompt, so repeating them here would only spend
    tokens.

    The LOGO is deliberately not passed through. A diffusion model asked to
    reproduce a logo produces a plausible-looking forgery of it, which is worse
    for the customer than no logo at all — so the composition reserves clear
    space and the real file is placed over the image afterwards.
    """
    if not isinstance(brand, Mapping) or not brand:
        return []

    lines: list[str] = []
    donts = brand.get("content_donts")
    if isinstance(donts, str) and donts.strip():
        lines.append(f"The brand also avoids: {donts.strip()}.")
    if brand_colours(brand) or (isinstance(donts, str) and donts.strip()):
        lines.append(
            "Leave one clear uncluttered corner for the brand's own logo file "
            "to be placed over the image afterwards."
        )
    return lines


# ── The brief the customer actually wrote ────────────────────────────────────

#: A sentence boundary, and NOT the full stop in "1." or "2.".
#:
#: The org-skill runner seeds the picture's brief from the step's
#: `prompt_template`, and the real catalogue templates are numbered writing
#: instructions — "Structure it as: 1. Where we stand … 4. What needs a decision
#: this week." Splitting on every full stop made each list marker a sentence, so
#: condensing the Monday Morning Brief template cut it at a bare trailing "4."
#: and handed the image model a dangling numeral. Both lookbehinds are
#: fixed-width, which `re` allows; a variable-width one would not compile.
_SENTENCE_END = re.compile(r"(?<=[.!?।])(?<![0-9]\.)\s+")


def condense(text: str, budget: int = SUBJECT_BUDGET) -> str:
    """Fit a brief to a budget WITHOUT cutting a word in half.

    `prompt[:200]` is the defect this replaces. It severed the brief mid-word,
    behind a generic prefix, and the owner's request was the opposite: the
    description of the skill IS the input. So the budget is wide, and where a
    brief genuinely exceeds it whole trailing sentences go first, then whole
    words, and only then is an ellipsis added so a reader can see something was
    dropped.
    """
    text = " ".join((text or "").split())
    if budget <= 0:
        # No room at all is not "keep almost everything". The tail slice below
        # reads `text[:budget - 1]`, so a budget of 0 returned the whole string
        # minus its last character — the one input that made this function
        # ignore its own contract.
        return ""
    if len(text) <= budget:
        return text

    sentences = _SENTENCE_END.split(text)
    kept: list[str] = []
    for sentence in sentences:
        candidate = " ".join(kept + [sentence])
        if len(candidate) > budget:
            break
        kept.append(sentence)
    if kept:
        return " ".join(kept)

    words = text.split(" ")
    out: list[str] = []
    for word in words:
        if len(" ".join(out + [word])) > budget - 1:
            break
        out.append(word)
    return (" ".join(out) + "…") if out else text[: budget - 1] + "…"


# ══════════════════════════════════════════════════════════════════════════════
# Composition — the deterministic half, and the fallback
# ══════════════════════════════════════════════════════════════════════════════
#
# ── THE THREE SHARES, AND WHY THEY ARE NUMBERS RATHER THAN A RATIO ───────────
#
# The whole composed prompt has to fit `ai_router._SUBJECT_LIMIT` — 700
# characters — and a rich direction plus a real brief is over 900. Something is
# dropped on every call, and the only question a design gets to answer is WHAT.
#
# It was answered by a 55/45 split, and the measurement of that split is why
# these are three explicit reservations instead. At 700 the brief took 385 and
# the lead sentence another 70, which left ~245 for six labelled lines of 60–110
# characters each. Measured across the catalogue: at a brief of 60 the locale
# went, at 150 the Mood, at 250 the Setting, at 300 the Lighting — and the Avoid
# line, appended last, went in 140 of 140 combinations including a brief of
# length zero. With brand colours set and a 385-character brief, only Subject
# and Composition survived and the org's own colours did not.

#: The floor under the customer's own words, in characters, dropped by whole
#: sentences. `prompt[:200]` mid-word behind a generic prefix was the defect;
#: nothing here may take the brief below this, and where a direction is terse
#: the brief gets more than this rather than exactly this.
_BRIEF_FLOOR = 280

#: And the skill's standing description gets its own slice of that floor.
#: Joined as `brief — description` and condensed as ONE string, the description
#: is the tail: measured, it vanished whole for every run brief over ~320
#: characters, which is every catalogue template — `run_org_skill` seeds the
#: brief from a `prompt_template` of 630–735 characters. The owner asked for a
#: "detailed image by description of skill"; a share it cannot lose is what
#: that has to mean.
_DESCRIPTION_SHARE = 140

#: What the negatives may take. They outrank the palette line because the router
#: restates a generic palette downstream and restates none of these — but a
#: 633-character avoid list starves everything after it, which is how the line
#: came to be dropped in the first place. Clauses are dropped from the tail, so
#: the per-template bans survive and the house ones yield.
#:
#: 180 is measured rather than chosen. Across all 35 authored directions at a
#: short brief: the per-template bans arrive on all 35 at every brief length up
#: to 650, "stock-photo clichés" reaches 32, and the cost is `Setting:` on 5 and
#: `Mood:` on 18. At 210 the clichés reach all 35 and `Setting:` is lost on 11,
#: which trades a visual line for a negative already implied by the subject; at
#: 160 the clichés reach 26 and nothing else is gained.
_AVOID_SHARE = 180


def _fit_avoid(specific: Sequence[str], house: Sequence[str],
               budget: Optional[int]) -> Optional[str]:
    """The negatives, fitted by dropping whole CLAUSES from the tail.

    The per-template bans come first and the house list yields, because the
    house list is the one `ai_router._GLOBAL_AVOID` partly restates and the
    per-template one is restated by nobody. "Depictions of any deity or
    religious figure" is the case that decides this: the router's own festival
    avoid says "no deity depicted inaccurately", which permits the drawing this
    module exists to forbid.

    A clause is a whole instruction, so dropping one is not the mid-sentence cut
    this module refuses everywhere else.
    """
    items = [x for x in (list(specific) + list(house)) if x]
    while items:
        line = "Avoid: " + "; ".join(items) + "."
        if budget is None or len(line) <= budget:
            return line
        items.pop()
    return None


def compose_brief(
    *,
    brief: str,
    direction: ArtDirection,
    art_key: str = "default",
    aspect_ratio: Optional[str] = None,
    description: Optional[str] = None,
    platform: Optional[str] = None,
    brand: Optional[Mapping] = None,
    notes: Optional[str] = None,
    source: str = "template",
    budget: Optional[int] = -1,
) -> ImageBrief:
    """Render an `ArtDirection` and a brief into one image prompt.

    Shape: a lead sentence carrying the customer's own words, then one labelled
    line per decision. FLUX-family encoders read long natural descriptions well
    and keyword soup badly, and the labels are what make a bad picture
    diagnosable — a reader holding the image against the brief can point at the
    line that did not happen.

    ── THE ORDER IS A PRIORITY ORDER, NOT A TASTE ────────────────────────────
    Written worst-loss-last, and the test of "worst" is whether anything else on
    the path says the same thing:

      · the lead, the Subject and the Composition are the picture, and the lead
        carries the locale cue because it is the one line no budget can drop;
      · the Avoid line is next, because the router restates none of the
        per-template bans;
      · the Colour line — the org's own colours where it has set any, so the two
        palettes can never both arrive and can never both be lost;
      · the surface and its real frame, which is 31 characters and is the only
        place the reader's platform choice appears at all;
      · then the brand's remaining instructions, then the light, then Setting
        and Mood;
      · and the full locale sentence last of all, because the lead already
        carries the short form of it.

    Lines are dropped WHOLE and in order rather than the tail being sliced. A
    half-sentence of art direction reads to the encoder as a different
    instruction, not as a shorter one.

    `budget=-1` means "ask the router what it will forward"; `None` means do not
    trim at all — which is a shape production never produces, so no assertion
    about what reaches a model may be made against it.
    """
    if budget == -1:
        budget = _downstream_budget()

    article = "An" if direction.medium[:1].lower() in "aeiou" else "A"
    # "in contemporary India" rides in the LEAD rather than waiting its turn in
    # the optional lines. Sixteen of the authored directions resolve to
    # `blog_hero` or `product_shot`, and neither preset carries an India cue of
    # any kind — so on those the locale reached the model only if the budget
    # happened to leave room, which measured as "never above a 60-character
    # brief". `ai_router._COMPOSED_LEAD` matches ", for an Indian business" to
    # recognise a composed brief; that substring is unchanged.
    head = f"{article} {direction.medium}, for an Indian business in contemporary India"

    def _lead(text: str) -> str:
        return f"{head}, about: {text}" if text else f"{head}."

    # The lines, built before the brief is measured, because the brief's share is
    # what is LEFT once the four that carry the picture have been reserved.
    subject_line = f"Subject: {direction.subject}."
    composition_line = f"Composition: {direction.composition}."
    avoid_line = _fit_avoid(
        direction.avoid, HOUSE_AVOID,
        None if not budget else min(_AVOID_SHARE, budget),
    )
    colours = brand_colours(brand)
    colour_line = (
        "Colour: the brand's own palette — " + ", ".join(colours)
        + " — as the dominant colours."
        if colours else f"Colour: {direction.palette}."
    )

    reserved = sum(
        1 + len(line)
        for line in (subject_line, composition_line, avoid_line, colour_line)
        if line
    )
    lead_overhead = len(_lead("_")) - 1
    if not budget:
        brief_budget = SUBJECT_BUDGET
    else:
        # The floor is a floor under the SHARE, not a promise the budget cannot
        # keep: `_downstream_budget` reads the router's limit, and a router that
        # moved it to 320 would otherwise be handed a 345-character lead and
        # slice it mid-word — this module's own defect, one layer down.
        room = max(0, budget - lead_overhead)
        brief_budget = min(room, max(_BRIEF_FLOOR, room - reserved))

    # The description is condensed on its own rather than as the tail of one
    # joined string, which is the whole of the fix: as a tail it was dropped
    # entire, and what the model was left holding on the Monday Morning Brief
    # template was a numbered writing instruction ending in a bare "4.".
    tail = condense(description or "", min(_DESCRIPTION_SHARE, brief_budget // 2))
    subject_brief = condense(brief, max(0, brief_budget - len(tail) - 3))
    lead = _lead(" — ".join(p for p in (subject_brief, tail) if p))

    rest: list[str] = [colour_line]
    if platform:
        # THE FRAME IN NUMBERS, and read back from the preset rather than left
        # blank when this module did not choose it. `quick_generate` names no
        # ratio, so this line said the surface and nothing about the canvas the
        # surface was going to be handed.
        #
        # Six words, not sixteen, and ahead of the light rather than behind it.
        # "…; keep the subject clear of the outer edge" is what every preset's
        # own direction already says — `auto` asks for "generous negative
        # space", `blog_hero` for "generous empty space across the left third" —
        # and at 66 characters the line was dropped for four of the seven quick
        # skills at a 60-character topic, so the platform the reader picked
        # reached the model in no form at all. At 31 characters it costs the
        # light nothing and it arrives.
        stated = aspect_for(requested=aspect_ratio, direction=direction) \
            or _preset_ratio(direction.style)
        frame = f", {stated} frame" if stated else ""
        rest.append(f"Surface: {platform}{frame}.")
    rest.extend(brand_notes(brand))
    rest += [
        f"Lighting: {direction.lighting}.",
        f"Setting: {direction.setting}.",
        f"Mood: {direction.register}.",
    ]
    if notes and notes.strip():
        rest.append(notes.strip())
    rest.append(LOCALE_NOTE)

    lines = [lead]
    used = len(lead)

    def _place(line: Optional[str]) -> None:
        """Add a line if it fits. A line that does not fit is SKIPPED, not a
        stop: measured on the six templates whose Subject and Composition run
        long, stopping at the first over-long line left 120 characters of the
        allowance unused and the `Avoid:` list outside the prompt. Priority is
        preserved by the order of the calls — everything above has already had
        first refusal on the space — and a shorter line below costs nothing.
        """
        nonlocal used
        if not line:
            return
        if budget and used + 1 + len(line) > budget:
            return
        lines.append(line)
        used += 1 + len(line)

    _place(subject_line)
    _place(composition_line)
    # Re-fitted against what is ACTUALLY left rather than against the fixed
    # share reserved above. The clauses yield one at a time and the
    # per-template bans are at the head of them, so a budget that cannot hold
    # the whole list still carries "depictions of any deity or religious
    # figure" — which the router restates nowhere and contradicts in the one
    # place it comes close.
    _place(_fit_avoid(
        direction.avoid, HOUSE_AVOID,
        None if not budget else min(_AVOID_SHARE, budget - used - 1),
    ))
    for line in rest:
        _place(line)

    return ImageBrief(
        prompt="\n".join(lines).strip(),
        style=direction.style if direction.style in STYLE_TOKENS else "auto",
        aspect_ratio=aspect_for(requested=aspect_ratio, direction=direction),
        art_key=art_key,
        source=source,
    )


# ══════════════════════════════════════════════════════════════════════════════
# Expansion — one cheap text call, and every way it is allowed to fail
# ══════════════════════════════════════════════════════════════════════════════

_EXPANSION_SYSTEM = (
    "You are an art director. You write briefs for image-generation models and "
    "nothing else.\n"
    "Rules:\n"
    "- Name objects, materials, focal lengths, light directions and named "
    "colours. Never adjectives of praise — they carry no visual information "
    "and a model resolves them to the average of its training data.\n"
    "- Never propose words, slogans or numerals inside the picture. The image "
    "will carry no lettering; the caption is set over it afterwards.\n"
    "- Never propose a logo, a brand mark or a recognisable person.\n"
    "- One sentence per field. Concrete nouns.\n"
    "Answer with a single JSON object and no other text. Keys exactly: "
    "subject, setting, composition, lighting, palette, medium, register."
)


def _expansion_prompt(brief: str, direction: ArtDirection,
                      platform: Optional[str],
                      aspect_ratio: Optional[str]) -> str:
    banned = ", ".join(SLOP_WORDS)
    return (
        "House art direction for this kind of picture — keep its register and "
        "its restraint, and make every line specific to the brief below:\n"
        f"  subject: {direction.subject}\n"
        f"  setting: {direction.setting}\n"
        f"  composition: {direction.composition}\n"
        f"  lighting: {direction.lighting}\n"
        f"  palette: {direction.palette}\n"
        f"  medium: {direction.medium}\n"
        f"  register: {direction.register}\n\n"
        f"The brief this picture is for:\n{condense(brief)}\n\n"
        # The frame the picture is ACTUALLY going to be rendered in. This read
        # "Frame: None" on essentially every image: only a caller that named a
        # ratio passed one, and `quick_generate` — the route the Generate tab
        # uses — never does. An art director asked for a composition without
        # being told the canvas writes for a square and gets a portrait.
        f"Surface: {platform or 'unspecified'}. "
        f"Frame: {aspect_ratio or 'as the surface expects'}.\n\n"
        "Do not use any of these words: " + banned + ".\n"
        "Return the JSON object now."
    )


def _text_model_reachable() -> bool:
    """No key, no call — which is also what keeps the offline suite offline.

    `GEMINI_API_KEY` is not consulted. The direct Gemini provider is named by no
    chain since 2026-08-16 (owner: stop spending the Google prepay balance), so
    treating its presence as reachability would send the expansion down a route
    `_select_providers` will not return.
    """
    return bool(os.getenv("OPENROUTER_API_KEY") or os.getenv("GROQ_API_KEY"))


def _parse_expansion(text: str) -> dict:
    """Pull the JSON object out of whatever the model wrapped it in."""
    if not text:
        return {}
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        data = json.loads(text[start: end + 1])
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}

    out: dict = {}
    for name in DIRECTION_SLOTS:
        value = data.get(name)
        if isinstance(value, (list, tuple)):
            value = ", ".join(str(v) for v in value)
        if isinstance(value, str) and value.strip():
            out[name] = " ".join(value.split()).rstrip(".")
    return out


def _reject_slop(patch: dict, direction: ArtDirection) -> dict:
    """Drop the fields that came back as praise, keep the ones that did not.

    Per FIELD rather than per answer. A model that writes a real composition and
    then calls the palette "vibrant colours" has produced six useful lines and
    one useless one; discarding all seven to punish the one is how a quality
    gate ends up lowering quality.
    """
    kept = {}
    for name, value in patch.items():
        if _SLOP_RE.search(value):
            log.debug("image_brief: %s came back as slop, keeping house line", name)
            continue
        kept[name] = value
    return kept


async def build_brief(
    *,
    brief: str,
    template_name: Optional[str] = None,
    template_description: Optional[str] = None,
    category: Optional[str] = None,
    skill: Optional[str] = None,
    agent_type: Optional[str] = None,
    platform: Optional[str] = None,
    aspect_ratio: Optional[str] = None,
    brand: Optional[Mapping] = None,
    overrides: Optional[Mapping] = None,
    notes: Optional[str] = None,
    org_id: Optional[str] = None,
    expand: bool = True,
) -> ImageBrief:
    """The one entry point. Never raises, never returns a truncated string.

    `template_description` travels BESIDE `brief` rather than glued to the end
    of it. The owner asked for a "detailed image by description of skill", and
    the description says what the skill IS while the brief says what THIS run is
    about — a festival skill's description does not name the festival, the run's
    variables do. Joined into one string and condensed as one string, the
    description was the tail and went first: measured, it was absent from every
    prompt whose run brief passed ~320 characters, which is every catalogue
    template, because `run_org_skill` seeds the brief from a `prompt_template`
    of 630–735 characters. `compose_brief` gives it a reserved share instead.

    Failure is a fallback, not an exception. This is called between a credit
    deduction and an image, and a brief-builder that throws would convert a
    picture the customer paid for into a refund plus a 500.
    """
    art_key, direction = art_direction_for(
        template_name=template_name, skill=skill,
        agent_type=agent_type, category=category,
    )
    direction = apply_overrides(direction, overrides)

    # THIS run first, the skill's standing description second. Diffusion models
    # weight early tokens, and the description is the general case ("posts for
    # upcoming Indian festivals") while the brief is the actual picture
    # ("Diwali, our Ahmedabad office closes 8-10 November").
    description = (template_description or "").strip()
    ratio = aspect_for(requested=aspect_ratio, direction=direction)
    # What the art director is told the canvas is, which is not the same
    # question as who chose it: `ratio` is None on almost every call because the
    # preset chooses, and the expansion prompt used to print that None.
    stated_frame = ratio or _preset_ratio(direction.style)

    if expand and _text_model_reachable():
        joined = " — ".join(p for p in (brief.strip() if brief else "", description) if p)
        expanded = await _expand(
            joined, direction, platform=platform, aspect_ratio=stated_frame,
            org_id=org_id,
        )
        if expanded:
            return compose_brief(
                brief=brief, description=description, direction=expanded,
                art_key=art_key, aspect_ratio=aspect_ratio, platform=platform,
                brand=brand, notes=notes, source="model",
            )

    return compose_brief(
        brief=brief, description=description, direction=direction,
        art_key=art_key, aspect_ratio=aspect_ratio, platform=platform,
        brand=brand, notes=notes, source="template",
    )


async def _expand(
    brief: str,
    direction: ArtDirection,
    *,
    platform: Optional[str],
    aspect_ratio: Optional[str],
    org_id: Optional[str],
) -> Optional[ArtDirection]:
    """One text call. Returns `None` on every failure, and there are several."""
    # Imported here rather than at module scope: `ai_router` opens the pool on
    # import-time-adjacent paths and this module is imported by the router at
    # startup. Local also means a test can patch `services.ai_router.generate`
    # and be seen.
    from services.ai_router import generate

    try:
        result = await asyncio.wait_for(
            generate(
                prompt=_expansion_prompt(brief, direction, platform, aspect_ratio),
                system=_EXPANSION_SYSTEM,
                max_tokens=EXPANSION_MAX_TOKENS,
                # English and `social_media` on purpose: that pair is the
                # cheapest chain `_select_providers` returns. The picture
                # carries no lettering, so the caption's language changes
                # nothing about the brief — only the locale note does, and that
                # is written in unconditionally.
                language="en",
                agent_type="social_media",
                task="content",
                org_id=org_id,
            ),
            timeout=EXPANSION_TIMEOUT_S,
        )
    except Exception as exc:
        # Deliberately total, and that includes the timeout. Every provider
        # failing raises `RuntimeError`, a dead pool raises from asyncpg, a bad
        # key raises from httpx, a slow one raises `TimeoutError` out of
        # `wait_for`; not one of them is a reason to fail an image the customer
        # has already been charged for.
        log.warning("image_brief expansion failed (%s), using house direction: %s",
                    type(exc).__name__, exc)
        return None

    patch = _reject_slop(_parse_expansion(result.get("text", "")), direction)
    if not patch:
        return None
    return replace(direction, **patch)


# ── Introspection, for the tests and for a future admin screen ───────────────

def known_art_keys() -> tuple[str, ...]:
    """Every template slug that has a hand-written direction."""
    return tuple(sorted(_TEMPLATE_ART))


def direction_fields() -> tuple[str, ...]:
    """The override keys, read off the dataclass so the two cannot drift."""
    return tuple(f.name for f in _fields(ArtDirection))
