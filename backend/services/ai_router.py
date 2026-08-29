"""
ai_router.py — Smart multi-provider AI routing for Sahayak (सहायक).
Routes by language + task type:
  - Indic languages → Gemini 2.5 Flash Lite / Flash (free or near it, strong
    Indic support; a Chinese-trained model answers Gujarati in transliterated
    mush, which is why this branch exists at all)
  - English bulk (social, ads) → GLM-4.5-Air (free)
  - English quality (blog, email, lead magnet) → GLM-4.5-Air, then Gemini 2.5
    Flash
  - Chatbot/RAG → GLM-4.5-Air, then the fast Gemini models
  - Premium (campaign/SEO) → Gemini 2.5 Pro
  - Fallback chain → Groq Llama, then whatever the latency budget demoted

Every chain is then filtered through a LATENCY BUDGET before it is returned —
`PROVIDER_LATENCY_MS` and `_apply_latency_budget` — because ordering by an idea
of quality that no measurement supported is how an English chat turn came to be
answered by a provider whose median reply takes 32.5 seconds. Re-measure with
`scripts/ai_latency_report.py`; read the two tables above `PROVIDER_LATENCY_MS`
first, because two of the providers these chains lead with have never once
answered a question.

Cost tracking: actual USD cost is extracted from OpenRouter response headers
and logged per generation for real spend analytics.

CREDITS ARE NO LONGER PRICED OR MOVED HERE. As of migration 095 there is one
ledger and it lives in `services/credits.py`. The four functions at the foot of
this file — `deduct_credits`, `deduct_org_credits`, `refund_org_credits`,
`_maybe_reset_monthly_credits` — survive only as DEPRECATED WRAPPERS, because
their names are pinned by callers this agent does not own and by
`tests/test_skill_module_access.py`. They hold no money logic. Read
`services/credits.py` for the model; read the block comment above `CREDIT_COSTS`
for why that dict is still here and why nothing may read it.
"""
import asyncio
import json
import logging
import os
import time
import uuid
from typing import AsyncIterator, Optional

import httpx

from db import get_pool

log = logging.getLogger(__name__)

INDIC_LANGS = {"hi", "gu", "bn", "ta", "te", "kn", "ml", "mr", "or", "pa"}
QUALITY_AGENTS = {"blog", "email", "lead_magnet"}
PREMIUM_AGENTS = {"campaign", "seo"}

# Display names, for the one caller that has to put a language into a PROMPT
# rather than into a routing decision. Picking a model that handles Gujarati
# does not make it answer in Gujarati; only asking it to does.
LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "gu": "Gujarati", "bn": "Bengali",
    "ta": "Tamil", "te": "Telugu", "kn": "Kannada", "ml": "Malayalam",
    "mr": "Marathi", "or": "Odia", "pa": "Punjabi",
}

# Unicode block → language code, one entry per writing system this product
# routes on. Script detection is sufficient here precisely because these ten
# languages do not share scripts: a Gujarati question arrives in Gujarati script
# and nothing else uses it.
#
# The single collision is Devanagari, which Hindi and Marathi share exactly.
# Nothing short of a real classifier separates them from characters alone, so
# Devanagari maps to "hi". That costs nothing where it matters — both are in
# INDIC_LANGS and `_select_providers` treats them identically — and where it
# does show, in the language NAME handed to the system prompt, the model is
# reading the user's actual Marathi and follows it regardless of the label.
_SCRIPT_RANGES = (
    (0x0900, 0x097F, "hi"),   # Devanagari — Hindi, Marathi
    (0x0980, 0x09FF, "bn"),   # Bengali
    (0x0A00, 0x0A7F, "pa"),   # Gurmukhi — Punjabi
    (0x0A80, 0x0AFF, "gu"),   # Gujarati
    (0x0B00, 0x0B7F, "or"),   # Odia
    (0x0B80, 0x0BFF, "ta"),   # Tamil
    (0x0C00, 0x0C7F, "te"),   # Telugu
    (0x0C80, 0x0CFF, "kn"),   # Kannada
    (0x0D00, 0x0D7F, "ml"),   # Malayalam
)

# How much of a message's alphabet an Indic script has to account for before it
# decides the routing. A majority rule would be wrong in the common direction:
# Indian users write heavily code-mixed and "please મને GST invoice મોકલો" is an
# ordinary sentence with more Latin letters in it than Gujarati ones. The floor
# exists for the opposite case — one pasted name in a long English message must
# not move the whole conversation onto an Indic model.
_SCRIPT_SHARE_FLOOR = 0.20


def detect_language(text: str) -> str:
    """Return a code from INDIC_LANGS, or "en".

    Script detection, not language identification, and deliberately so: it needs
    no model, no network and no dependency, it cannot fail open into a billed
    call, and for the ten languages routing cares about it is very nearly exact.
    An English message with no Indic characters in it can only ever come back
    "en", which is the answer the product has been hard-coding anyway — so the
    worst case of this function is the status quo.

    Counts LETTERS only. Digits, punctuation, whitespace and emoji are evidence
    of nothing: "GSTR-3B ક્યારે?" is a Gujarati question with more non-letters
    in it than letters.
    """
    if not text:
        return "en"

    counts: dict[str, int] = {}
    letters = 0
    for ch in text:
        if not ch.isalpha():
            continue
        letters += 1
        cp = ord(ch)
        for lo, hi, code in _SCRIPT_RANGES:
            if lo <= cp <= hi:
                counts[code] = counts.get(code, 0) + 1
                break

    if not letters or not counts:
        return "en"

    code, hits = max(counts.items(), key=lambda kv: kv[1])
    return code if (hits / letters) >= _SCRIPT_SHARE_FLOOR else "en"


# Per-token pricing (USD per 1 token) — updated from OpenRouter, used for estimation when headers missing
# ── The two Gemini models, pinned by version ───────────────────────────────────
#
# NEVER a `-latest` alias here. `gemini-flash-latest` resolved to 3.6 Flash the
# moment Google promoted it, and the first successful grounded call on it billed
# £0.04 — from a model nobody chose, at a price nobody agreed, with no code
# change and no warning. An alias is a standing instruction to Google to move us
# onto its newest and dearest model whenever it likes. Pin the version; upgrade
# when WE decide to, having looked at the price.
#
# WHY NOT 2.0, WHICH IS WHAT WAS ASKED FOR. Because this key cannot call it.
# Probed against the live staging key on 2026-08-08, ungrounded, one request
# apart:
#
#   gemini-2.0-flash-lite     -> 429  no quota on this key
#   gemini-2.0-flash          -> 429  no quota on this key
#   gemini-2.5-flash-lite     -> 404  "no longer available to new users"
#   gemini-2.5-flash          -> 404  "no longer available to new users"
#   gemini-3.1-flash-lite     -> 200
#
# Both families are still listed by `models.list`, which is what makes this
# worth writing down: the catalogue advertises models the account cannot use.
# 2.0 is quota-zero for keys issued now and 2.5 is closed to new projects, so
# pinning to either would have shipped a chatbot that 429s on every question.
# 3.1 Flash Lite is the cheapest tier that actually answers.
#
# The two constants stay separate so grounding can move to a different model
# with a one-line change. They are equal today because grounding returns 429 on
# EVERY model on this key — it is an entitlement on the key, not a property of
# the model — so there is nothing yet to measure a grounding model against.
GEMINI_TEXT_MODEL = "gemini-3.1-flash-lite"
GEMINI_GROUNDING_MODEL = "gemini-3.1-flash-lite"

MODEL_PRICING = {
    "google/gemini-2.5-flash-lite-preview": {"prompt": 0.0, "completion": 0.0},
    "glm-4-air": {"prompt": 0.0, "completion": 0.0},
    "qwen/qwen3-30b-a3b": {"prompt": 0.0000001, "completion": 0.0000004},
    "qwen/qwen-plus": {"prompt": 0.0000008, "completion": 0.0000020},
    "google/gemini-2.5-flash-preview": {"prompt": 0.00000015, "completion": 0.0000006},
    "google/gemini-2.5-pro-preview": {"prompt": 0.0000025, "completion": 0.000015},
    "gemini-2.0-flash": {"prompt": 0.0000001, "completion": 0.0000004},
    # `gemini-2.0-flash-lite` — the pinned text model. Without an entry here,
    # `_estimate_cost` matched nothing and every direct Gemini call was logged at
    # $0.00: the spend report said the chatbot was free while Google invoiced for
    # it. List prices, for the log; the bill remains the authority.
    "gemini-3.1-flash-lite": {"prompt": 0.0000001, "completion": 0.0000004},
    "llama-3.3-70b-versatile": {"prompt": 0.00000059, "completion": 0.00000079},
    # ── The five models this table could not price, 2026-08-19 ──────────────
    #
    # Every key above is matched as a SUBSTRING of the model id (see
    # `_estimate_cost`), and five of the ids the router can actually name
    # matched nothing at all — so `_estimate_cost` returned 0.0 and every call
    # that had to fall back to it was logged at $0.0000. Measured against
    # `staging.hub_ai_providers` on 2026-08-19; each row is a live provider
    # named by a chain in `_select_providers`:
    #
    #   thudm/glm-4.5-air:free   the key was `glm-4-air`, which is not a
    #                            substring of `glm-4.5-air` — a version bump
    #                            silently unpriced the model
    #   qwen/qwen3.6-flash       the key was `qwen/qwen3-30b-a3b`
    #   qwen/qwen3.6-plus        the key was `qwen/qwen-plus`
    #   google/gemini-2.5-flash  the key was `…-flash-preview`, which is LONGER
    #                            than the id, so it can never match it
    #   google/gemini-2.5-pro    the key was `…-pro-preview`, same shape
    #
    # The two `-preview` keys stay: they are the ids the preview endpoints
    # return, and longest-match keeps them winning for those.
    #
    # PRICES. List price per token, verified against what we were actually
    # invoiced: `usage.cost` on `staging.hub_ai_logs` is OpenRouter's own
    # reported charge, and a two-unknown least-squares fit of cost against
    # (prompt_tokens, completion_tokens) over every invoiced row recovers the
    # per-token rate exactly. Fitted 2026-08-19 over the rows then present:
    #
    #   qwen/qwen3.6-flash       94 rows -> $0.1875/M in, $1.125/M out
    #   qwen/qwen3.6-plus        10 rows -> $0.325/M in,  $1.95/M out
    #   google/gemini-2.5-flash  17 rows -> $0.30/M in,   $2.50/M out
    #   google/gemini-2.5-pro     5 rows -> $1.25/M in,   $10.00/M out
    #
    # The two Gemini fits are Google's published list prices to the cent
    # (ai.google.dev/pricing, read 2026-08-19), which is what makes the method
    # trustworthy for the two Qwen ids, whose OpenRouter rate is the number we
    # are billed rather than a list price anyone publishes.
    #
    # `thudm/glm-4.5-air:free` is zero because the `:free` suffix IS the price —
    # OpenRouter's free variants bill nothing and the 81 logged calls total
    # $0.00. Written down rather than left to fall through, so that a future
    # move off `:free` shows up as a price change instead of as silence.
    "thudm/glm-4.5-air:free": {"prompt": 0.0, "completion": 0.0},
    "qwen/qwen3.6-flash": {"prompt": 0.0000001875, "completion": 0.000001125},
    "qwen/qwen3.6-plus": {"prompt": 0.000000325, "completion": 0.00000195},
    "google/gemini-2.5-flash": {"prompt": 0.0000003, "completion": 0.0000025},
    "google/gemini-2.5-pro": {"prompt": 0.00000125, "completion": 0.00001},
}

#: Every model id the text chains can name, and the provider row it comes from.
#:
#: `default_model` lives in `staging.hub_ai_providers`, which a unit test cannot
#: read — so the ratchet in `tests/test_model_pricing_is_complete.py` needs the
#: reachable set written down here. Two halves, and neither alone is enough:
#:
#:   · the test asserts every id here matches a MODEL_PRICING key, so adding a
#:     provider to a chain without pricing it fails the build;
#:   · it also asserts every provider code named by any `_select_providers`
#:     chain appears below, so a chain cannot quietly reach a model this map has
#:     never heard of.
#:
#: What it CANNOT catch is somebody editing `default_model` in the database to
#: an id nothing here knows. That case is caught at runtime instead:
#: `_estimate_cost` warns by name when it prices a model it has no entry for.
#:
#: Verified against the live provider table on 2026-08-19. `sarvam` and the
#: direct `gemini` row are absent on purpose — no chain names either, and the
#: `gemini` row is `is_active=FALSE`.
REACHABLE_MODELS: dict[str, str] = {
    "google/gemini-2.5-flash-lite-preview": "gemini_lite_or",
    "thudm/glm-4.5-air:free": "glm",
    "qwen/qwen3.6-flash": "qwen_flash",
    "qwen/qwen3.6-plus": "qwen_plus",
    "google/gemini-2.5-flash": "gemini_flash_or",
    "google/gemini-2.5-pro": "gemini_pro_or",
    "llama-3.3-70b-versatile": "groq",
}

_PROVIDER_KEYS = {
    "gemini_lite_or": "OPENROUTER_API_KEY",
    "glm": "OPENROUTER_API_KEY",
    "qwen_flash": "OPENROUTER_API_KEY",
    "qwen_plus": "OPENROUTER_API_KEY",
    "gemini_flash_or": "OPENROUTER_API_KEY",
    "gemini_pro_or": "OPENROUTER_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
}

_providers_cache: dict | None = None


async def _get_providers() -> dict[str, dict]:
    global _providers_cache
    if _providers_cache is not None:
        return _providers_cache
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT code, api_base_url, default_model, priority, config "
        "FROM public.hub_ai_providers WHERE is_active=TRUE ORDER BY priority"
    )
    _providers_cache = {r["code"]: dict(r) for r in rows}
    return _providers_cache


def clear_provider_cache():
    global _providers_cache
    _providers_cache = None


# ── MEASURED LATENCY, AND THE BUDGET BUILT ON IT ──────────────────────────────
#
# The chain used to be ordered by an idea of quality that no measurement
# supported, and the bill for that was never money — lifetime spend across every
# AI call ever made is $2.19. It was seconds.
#
# TWO TABLES, BECAUSE A PROVIDER THAT FAILS FAST IS NOT A FAST PROVIDER. Read
# off `staging.hub_ai_logs` on 2026-08-19, all 303 rows since 2026-07-12, split
# by `status` — which is the split that changes the answer:
#
#   provider          p50 answer   calls   note
#   gemini               2,642 ms     18   direct; retired 2026-08-16, no chain
#   gemini_flash_or      3,555 ms     19   zero errors ever
#   qwen_flash          14,491 ms     94   the most-used provider
#   qwen_plus           32,545 ms     13   what English chat really falls to
#   gemini_pro_or       38,696 ms      5
#
#   glm                  NEVER        84   every call a 400, p50 64 ms
#   gemini_lite_or       NEVER        16   every call a 400, p50 41 ms
#   groq                 NEVER         0   GROQ_API_KEY is unset on staging
#
# **`glm` AND `gemini_lite_or` HAVE NEVER ANSWERED A SINGLE QUESTION.** Both are
# `is_active=TRUE` in `staging.hub_ai_providers` pointing at model ids OpenRouter
# rejects — `thudm/glm-4.5-air:free is not a valid model ID`, still 400ing on
# 2026-08-19, and `google/gemini-2.5-flash-lite-preview` likewise. The "195 ms
# free provider" and the "82 ms free provider" are the time OpenRouter takes to
# refuse them. Nothing here can fix that: `default_model` is a database column,
# and staging shares its database with production.
#
# So they keep the lead — they cost 105 ms of 400s between them and they become
# the right answer the moment the ids are corrected — but every English answer
# the product has actually given was served by whatever stood behind them, and
# for chat that was `qwen_plus` at 32.5 seconds. That is the defect this
# ordering exists to remove, and it is larger than the report that prompted the
# work said — that report averaged all 297 rows without filtering `status`, so
# the two providers that have only ever failed came out holding the fastest
# figures in the product.
#
# LENGTH-CONTROLLED, because a provider that only ever writes blog posts looks
# slow next to one that only ever writes captions. Successes split at 400
# completion tokens:
#
#                     short (n)        long (n)      median out
#   gemini_flash_or   1,551  (8)      5,914 (9)         461
#   qwen_flash        1,915  (3)     14,803 (91)      1,950
#   qwen_plus             —          32,545 (12)      1,878
#   gemini_pro_or         —          38,696 (5)       4,072
#
# It holds up: `gemini_flash_or` is the faster provider at both lengths, and
# `qwen_flash`'s headline 14,491 ms is mostly the long-form traffic the quality
# tier used to send it.
#
# THESE ARE A SNAPSHOT, NOT A CONSTANT. Retake with
# `python scripts/ai_latency_report.py` (read-only, run from `backend/`): it
# prints p50/p95 per provider against these figures, separates rejections from
# answers, and names every chain whose real answerer has drifted past its
# budget. The ratchet in `tests/test_latency_budget.py` enforces that the ORDER
# follows whatever the numbers say — not that these numbers stay true.
#
# `openrouter` and `openrouter_seedream` appear in the log with 47 successes and
# $1.73 between them and are deliberately absent here: both are IMAGE codes
# (`…-flash-lite-image`, `seedream-4.5`), reached by `generate_image`, and no
# text chain can name either.
PROVIDER_LATENCY_MS: dict[str, int] = {
    "gemini": 2_642,
    "gemini_flash_or": 3_555,
    "qwen_flash": 14_491,
    "qwen_plus": 32_545,
    "gemini_pro_or": 38_696,
}

#: What it costs to TRY a provider that has never once answered.
#:
#: Separate from the table above on purpose. These two are free and they are
#: first in most chains, which is only defensible while their failure is this
#: cheap: 105 ms of 400s buys the free tier the instant somebody corrects the
#: model ids. If a rejection ever becomes a timeout instead of a 400, the same
#: chains become a five-second tax on every answer with nothing to show for it,
#: and `tests/test_latency_budget.py` fails rather than waiting to be noticed.
#:
#: `groq` is in neither table: no key is set on staging, so it has never been
#: called at all and nothing bounds what it would cost. That is exactly why the
#: ratchet forbids an entirely unmeasured provider from standing in front of the
#: one doing the answering.
PROVIDER_REJECTS_MS: dict[str, int] = {
    "gemini_lite_or": 41,
    "glm": 64,
}

#: How long a task is allowed to make somebody wait before a provider is pushed
#: behind the rest of its chain.
#:
#: All three are DERIVED from the table above rather than chosen, because a
#: budget picked by taste is a budget that gets argued with:
#:
#:   interactive   4,000 ms — a chat turn. The SMALLEST budget that still admits
#:                 `gemini_flash_or` at 3,555 ms — the only provider a chain may
#:                 name that has ever answered in under fourteen seconds, the
#:                 quicker `gemini` being the retired direct one. Below it,
#:                 every chain would be left with no working answerer inside its
#:                 own budget. It excludes qwen_flash (14,491), qwen_plus (32,545)
#:                 and gemini_pro_or (38,696), none of which anybody should meet
#:                 mid-conversation.
#:   bulk         20,000 ms — a blog post or a batch of captions: one click, one
#:                 wait, no cursor blinking. The smallest round number above
#:                 `qwen_flash` at 14,491 ms, because below it English bulk
#:                 content would have no working provider left at all.
#:   batch        45,000 ms — campaign and SEO. The reasoning is long enough to
#:                 live in `_latency_class`, where the decision is made.
LATENCY_BUDGET_MS: dict[str, int] = {
    "interactive": 4_000,
    "bulk": 20_000,
    "batch": 45_000,
}


def _latency_class(agent_type: str = "social_media", task: str = "content") -> str:
    """Which budget in `LATENCY_BUDGET_MS` this call is judged against.

    THE BRANCH ORDER HERE MIRRORS `_declared_chain`, AND HAS TO KEEP MIRRORING
    IT. Premium is tested first in both, so `agent_type="campaign"` with
    `task="chatbot"` gets the premium chain AND the batch budget — the two agree
    on which branch won. A budget that disagreed with the branch that built the
    chain would silently stop applying to it, which is the exact failure this
    mechanism exists to prevent; `tests/test_latency_budget.py` pins that
    collision case rather than trusting the two functions to be read together.

    ── WHY CAMPAIGN AND SEO ARE ALLOWED 45 SECONDS ──────────────────────────

    They lead with `gemini_pro_or`, measured at 38,696 ms — by a wide margin the
    slowest thing this router can reach — and that is kept deliberately. A
    campaign brief or an SEO plan is one deliberate click producing a long
    structured document, not a turn in a conversation: nobody is watching a
    cursor between messages, and 2.5 Pro is the only genuinely stronger model in
    the catalogue, which is the entire reason the tier exists. Cost is not an
    argument in either direction — five lifetime calls, $0.1992, against $2.19
    spent on everything ever.

    What 45,000 is NOT is an endorsement of 37 seconds. That figure is five
    calls, so it is not a p50 anyone should trust, and this is a CEILING: if Pro
    drifts towards a minute the ratchet fails the build and somebody has to look
    at it rather than discovering it from a complaint. And if campaign or SEO
    ever becomes something a reader watches stream, it belongs on the
    interactive budget and this chain has to be re-ordered — changing the class
    here without re-ordering there is precisely what the ratchet catches.
    """
    if agent_type in PREMIUM_AGENTS:
        return "batch"
    if task == "chatbot":
        return "interactive"
    return "bulk"


def _apply_latency_budget(chain: list[str], budget_ms: int) -> list[str]:
    """Push every provider measured slower than `budget_ms` behind the measured
    providers that are inside it.

    A STABLE PARTITION, NOT A SORT. Sorting by latency would put
    `gemini_lite_or` (41 ms to refuse) ahead of `gemini_flash_or` (3,555 ms to
    answer) in the Indic chains and quietly undo the language decision those
    chains exist for — on a number that is not even an answer. Order WITHIN each
    half is the declared one; only the two halves move.

    NOTHING IS DROPPED. A chain that lost its slow tail would turn a
    rate-limited free tier into an outage instead of into one wasted round trip.
    Over-budget providers still answer — they answer last.

    A PROVIDER WITH NO ANSWER LATENCY HOLDS ITS DECLARED SLOT, and the reason is
    the same in both directions: there is no measurement, so there is nothing to
    move it on. Three of the eight providers are in that state. `glm` and
    `gemini_lite_or` have only ever been refused, in 64 ms and 41 ms; `groq` has
    never been called at all, so nothing bounds it even that far.

    THIS WAS WRITTEN AS `PROVIDER_LATENCY_MS.get(c, 0)`, WHICH SCORES AN
    UNMEASURED PROVIDER AS INSTANT. Demoting on absence would punish a provider
    for never having been reached; scoring absence as zero did the opposite and
    rewarded it. Indic chat declares
    `[gemini_flash_or, gemini_lite_or, qwen_plus, groq]` — qwen_plus at 32,545 ms
    is over the interactive budget and is demoted, and `groq` came up from fourth
    to third on a nought nobody measured. So a Gujarati question that got past
    Gemini was answered by Llama 3.3 70B instead of by the fallback the Indic
    branch had deliberately put ahead of it — in the branch that exists because a
    model reasoning in English "answers a Gujarati question in English or in
    transliterated mush". It is the same mistake in miniature as the report that
    started this work: an unfiltered number standing in for a measurement.

    So only providers that HAVE an answer latency take part. Their positions in
    the chain are the slots, they are partitioned within-then-over across those
    slots, and everything else stays exactly where `_declared_chain` put it.
    `PROVIDER_REJECTS_MS` is deliberately not read here — what a refusal costs is
    a judgement about what somebody wrote, and it is enforced as a build gate in
    `tests/test_latency_budget.py`: the first provider in a chain that has ever
    ANSWERED must be inside the budget, and only cheap known rejections may stand
    in front of it.

    NO DATABASE READ, deliberately. This runs on the way into every generation.
    A query to decide routing is itself the latency the whole mechanism is here
    to remove, and `hub_ai_logs` is the table it would have to read — the one
    this call is about to write a row to.
    """
    slots = [i for i, code in enumerate(chain) if code in PROVIDER_LATENCY_MS]
    measured = [chain[i] for i in slots]
    within = [c for c in measured if PROVIDER_LATENCY_MS[c] <= budget_ms]
    over = [c for c in measured if PROVIDER_LATENCY_MS[c] > budget_ms]

    ordered = list(chain)
    for slot, code in zip(slots, within + over):
        ordered[slot] = code
    return ordered


def _select_providers(language: str = "en", agent_type: str = "social_media", task: str = "content") -> list[str]:
    """Return ordered list of provider codes based on language, agent type, and task.

    Two steps, and they answer different questions. `_declared_chain` says which
    models can serve this language and this quality tier, in the order somebody
    decided they should. `_apply_latency_budget` then says how long the reader
    of THIS task will tolerate, and demotes anything measured slower. Keeping
    them apart is what stops a latency pass silently rewriting a language
    decision, and what lets each be tested for the thing it claims.

    Callers see only the finished order. No chain differs from its declared one
    today — every branch in `_declared_chain` was re-ordered from the same
    measurements, so the budget has nothing left to demote. That is the state to
    want from a guard, and `tests/test_latency_budget.py` proves it still fires
    rather than assuming a quiet pass means a working one.
    """
    return _apply_latency_budget(
        _declared_chain(language, agent_type, task),
        LATENCY_BUDGET_MS[_latency_class(agent_type, task)],
    )


def _declared_chain(language: str = "en", agent_type: str = "social_media", task: str = "content") -> list[str]:
    """The chains as language and quality want them, before any latency budget.

    ── THE DIRECT `gemini` PROVIDER IS GONE, 2026-08-16 ────────────────────

    Owner decision: stop spending the Google prepay balance. `gemini` — the only
    provider keyed on `GEMINI_API_KEY` — is named by no chain here any more.

    The Gemini MODELS remain, through OpenRouter: `gemini_lite_or`,
    `gemini_flash_or` and `gemini_pro_or`. So the Indic branch below still leads
    with a Gemini-family model, which is the whole reason that branch exists;
    what changed is the wallet, not the answer.

    Three surfaces were checked before removing it, not one:
      · TEXT — this function. Every chain re-pointed.
      · IMAGES — already off. `generate_image` reaches Gemini Imagen only when
        GEMINI_IMAGE_ENABLED=1, which is unset; it is the fallback of a fallback.
      · EMBEDDINGS — `services/rag.py::generate_embedding` prefers the same key
        and falls back to OpenRouter. That fallback is a DIFFERENT VECTOR SPACE,
        so it would silently break similarity search against stored vectors —
        except that `staging.hub_kb_chunks.embedding` was measured at ZERO
        non-null rows, so there is nothing to invalidate. **If embeddings are
        ever backfilled, that fallback becomes a trap again.**

    `_call_gemini` is deliberately left in place. It is unreachable from these
    chains today, and it is the only code that can attach
    `tools: [{google_search: {}}]` — worth keeping intact should the grounding
    entitlement ever be granted, rather than rewritten from scratch later.
    """
    # Campaign & SEO — always use best model regardless of language.
    #
    # This one is NOT re-ordered, and that is a decision rather than an
    # oversight. `gemini_pro_or` measured 38,696 ms, the slowest provider in the
    # log by a factor of two, and it keeps the lead because the work is a
    # deliberate long generation and not a conversational turn: one click, one
    # document, nobody watching a cursor. `_latency_class` carries the argument
    # and the ceiling that makes it falsifiable.
    if agent_type in PREMIUM_AGENTS:
        return ["gemini_pro_or", "gemini_flash_or", "qwen_flash", "groq"]

    if task == "chatbot":
        # ── WHY THE FREE MODEL LEADS IN ENGLISH, 2026-08-16 ─────────────────
        #
        # Gemini direct used to lead every language here, on the grounds that it
        # is the only provider `_call_gemini` can hang `tools: [{google_search:
        # {}}]` on. THAT REASON NO LONGER HOLDS. Chat's web search moved to
        # Serper, and Serper runs BEFORE this function is called: `hub.py`
        # renders its results into the prompt as text, so whichever model
        # answers reads the same web results. The Gemini grounding block is
        # still read downstream only "in case the entitlement is ever granted",
        # and it has not been.
        #
        # So English chat now leads with `glm` — `thudm/glm-4.5-air:free`, which
        # costs nothing — and every paid model still stands behind it. A free
        # tier that rate-limits or errors is not an outage: the loop below logs
        # the failure to `hub_ai_logs` and moves to the next provider, so the
        # worst case is one wasted round trip before Gemini answers exactly as
        # it does today.
        #
        # INDIC IS DELIBERATELY UNCHANGED. The branch below was built because
        # Qwen Plus "answers a Gujarati question in English or in transliterated
        # mush", and a Chinese-trained model leading the Indic chain invites the
        # same class of defect the branch exists to prevent. Cheapness is not
        # worth an answer the reader cannot use. Revisit only with evidence.
        #
        # This branch sits above the Indic branch below and so used to swallow
        # it whole: an Indic chat that fell past Gemini landed on Qwen Plus, our
        # strongest ENGLISH reasoner, which answers a Gujarati question in
        # English or in transliterated mush. The Indic fallbacks are the two
        # Gemini-family models on OpenRouter — the same pair the Indic content
        # branch below already picks — and Qwen only after them.
        #
        # ── WHAT ENGLISH CHAT WAS REALLY ANSWERED BY, 2026-08-19 ───────────
        #
        # WAS ["glm", "qwen_plus", "qwen_flash", "gemini_lite_or", "groq"], and
        # the first entry has never answered a question in its life: 84 calls,
        # 84 rejections, `thudm/glm-4.5-air:free is not a valid model ID`. So
        # every English chat answer this product has given was served by the
        # SECOND entry — `qwen_plus`, whose median successful reply is 32,545 ms
        # and whose long-form median is the same figure. Half a minute, for a
        # chat message, while `gemini_flash_or` answered in 3,555 ms overall and
        # 1,551 ms for a short reply and was not in this chain at all.
        #
        # The two free providers keep the lead. They are wrong today and they
        # cost 105 ms of 400s to prove it, which is a rounding error against
        # what stands behind them — and the day somebody corrects those two
        # model ids in `hub_ai_providers`, English chat is free and fast without
        # another code change. What is fixed here is the answer a reader
        # actually gets: `gemini_flash_or` now stands directly behind them.
        #
        # `qwen_flash` before `qwen_plus`: 14,491 against 32,545, and qwen_plus
        # has never once produced a short answer — all thirteen of its successes
        # run past 400 completion tokens. Both miss the interactive budget, so
        # this only decides which of the two a reader meets after everything
        # faster has failed — but the faster one should be first even there.
        #
        # BOTH CHAINS COME BACK FROM THE BUDGET UNCHANGED, which is the state to
        # want: the order declared here already puts the fast answerer in front
        # of the slow one, so there is nothing left for `_apply_latency_budget`
        # to correct and it corrects nothing. It is a guard against the next
        # chain somebody writes, not a live reorder of these.
        #
        # It did not always return them unchanged, and the difference was a
        # defect rather than a feature: scoring an unmeasured provider as 0 ms
        # lifted `groq` past `qwen_plus` in both chains, handing an Indic
        # question to Llama 3.3 70B ahead of the fallback this branch chose.
        # `tests/test_latency_budget.py` pins the positions now.
        if language in INDIC_LANGS:
            return ["gemini_flash_or", "gemini_lite_or", "qwen_plus", "groq"]
        return ["glm", "gemini_lite_or", "gemini_flash_or",
                "qwen_flash", "qwen_plus", "groq"]

    if language in INDIC_LANGS:
        if agent_type in QUALITY_AGENTS:
            return ["gemini_flash_or", "gemini_lite_or", "qwen_flash", "groq"]
        return ["gemini_lite_or", "gemini_flash_or", "qwen_flash", "groq"]

    if agent_type in QUALITY_AGENTS:
        # WAS ["qwen_flash", "glm", "groq"], and since `glm` has never answered
        # anything, that made `qwen_flash` the sole author of every blog, email
        # and lead magnet the product has produced — 91 of its 94 successful
        # calls carry more than 400 completion tokens, which is this tier's
        # traffic and nothing else's. Its long-form median is 14,803 ms against
        # `gemini_flash_or`'s 5,914 ms on the same length bucket.
        #
        # So the free model leads, as it already does for bulk, and the tier's
        # working provider is now `gemini_flash_or`: two and a half times faster
        # on exactly the shape of output this branch generates, for roughly
        # twice qwen_flash's per-token price. That trade is only obviously right
        # because of the other measurement — lifetime spend across every AI call
        # ever made is $2.19 — and it would not be right at a hundred times the
        # volume.
        #
        # The premise this branch was built on, that qwen3.6-flash writes better
        # long-form than glm-4.5-air, has never been measured and cannot be
        # until there is an eval set (proposal 69, mechanism C). It is a
        # Flash-tier model on both sides of that comparison. What is measured is
        # the nine seconds, so the nine seconds decide.
        #
        # qwen_flash stays behind it: nothing that used to answer has stopped.
        return ["glm", "gemini_flash_or", "qwen_flash", "groq"]

    # English bulk (social_media, ad_copy, whatsapp). LEFT ALONE, deliberately.
    #
    # `qwen_flash`'s headline 14,491 ms would look like the same defect the tier
    # above just had, and it is not: that figure is the long-form work this
    # branch does not do. Split at 400 completion tokens, qwen_flash answers a
    # short generation in 1,915 ms — captions and ad copy are short, it is
    # inside the 20,000 ms bulk budget with room to spare, and it is the cheaper
    # of the two per token. There is nothing here that a reorder would buy.
    return ["glm", "qwen_flash", "groq"]


async def _call_gemini(api_key: str, base_url: str, model: str, prompt: str, system: str = "", max_tokens: int = 2048, grounded: bool = False) -> dict:
    url = f"{base_url}/models/{model}:generateContent"
    # `x-goog-api-key`, not `?key=` — httpx logs the request URL at INFO, so a
    # key in the query string is written to the deploy log on every call.
    # See services/apify.py for the same fix and the log line that proved it.
    headers = {"x-goog-api-key": api_key}
    contents = []
    if system:
        contents.append({"role": "user", "parts": [{"text": system}]})
        contents.append({"role": "model", "parts": [{"text": "Understood. I will follow these instructions."}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})

    payload = {
        "contents": contents,
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.7},
    }

    if grounded:
        payload["tools"] = [{"google_search": {}}]

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    candidate = data["candidates"][0]
    parts = candidate["content"]["parts"]
    text = "".join(p.get("text", "") for p in parts if "text" in p)

    grounding_sources = []
    if grounded:
        grounding_meta = candidate.get("groundingMetadata", {})
        for chunk in grounding_meta.get("groundingChunks", []):
            web = chunk.get("web", {})
            if web.get("uri"):
                grounding_sources.append({"title": web.get("title", ""), "url": web["uri"]})

    usage = data.get("usageMetadata", {})
    prompt_tokens = usage.get("promptTokenCount", 0)
    completion_tokens = usage.get("candidatesTokenCount", 0)
    return {
        "text": text,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": _estimate_cost(model, prompt_tokens, completion_tokens),
        "generation_id": "",
        "grounding_sources": grounding_sources,
    }


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Estimate USD cost from token counts when headers don't provide it."""
    # LONGEST match, not first. These keys are prefixes of one another —
    # "gemini-2.0-flash" is a substring of "gemini-2.0-flash-lite" — so a
    # first-match scan priced the Lite model at full Flash rates depending on
    # nothing more than dict insertion order. Longest-match makes the table
    # order-independent, which is the only way this stays correct as models
    # are added by someone who has not read this comment.
    name = model.lower()
    best = max((k for k in MODEL_PRICING if k in name), key=len, default=None)
    if best is None:
        # SAID OUT LOUD. Five ids reached this line for months and the only
        # trace was a $0.0000 row in `hub_ai_logs` — indistinguishable from a
        # free model, which is why every per-org spend report understated. A
        # price is still not invented here; the report is just no longer the
        # first place the omission shows up.
        log.warning(
            "No MODEL_PRICING entry for %r — logging this call at $0.0000. Add "
            "the model to MODEL_PRICING and REACHABLE_MODELS.", model,
        )
        return 0.0
    prices = MODEL_PRICING[best]
    return (prompt_tokens * prices["prompt"]) + (completion_tokens * prices["completion"])


async def _call_openai_compat(api_key: str, base_url: str, model: str, prompt: str, system: str = "", max_tokens: int = 2048) -> dict:
    """OpenAI-compatible API call (works for Groq, OpenRouter, and all OR-hosted models).
    Extracts actual USD cost from OpenRouter response headers when available."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    choice = data["choices"][0]
    usage = data.get("usage", {})
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)

    # OpenRouter returns actual cost in usage.cost or total_cost
    cost_usd = 0.0
    if usage.get("cost") is not None:
        cost_usd = float(usage["cost"])
    elif usage.get("total_cost") is not None:
        cost_usd = float(usage["total_cost"])
    elif data.get("usage", {}).get("cost") is not None:
        cost_usd = float(data["usage"]["cost"])
    else:
        cost_usd = _estimate_cost(model, prompt_tokens, completion_tokens)

    generation_id = data.get("id", "")

    return {
        "text": choice["message"]["content"],
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": cost_usd,
        "generation_id": generation_id,
    }


# ── Streaming ────────────────────────────────────────────────
#
# A second way to make the same call, not a second pipeline. `generate()` above
# is unchanged and is what every other caller in the product uses; the two
# functions below exist because a chat that prints a finished paragraph after
# nine seconds feels broken while the same nine seconds spent printing feels
# fast. Nothing about the answer differs — same chain, same prompt, same
# accounting row.

#: Read from the provider's SSE stream. Longer than the 60s the blocking calls
#: use because the clock here measures the WHOLE answer rather than one round
#: trip, and a long answer legitimately takes longer than a short one. httpx
#: applies this per-read as well, so a provider that stops sending is still cut
#: off rather than held open forever.
STREAM_TIMEOUT = 120

#: Characters per token, for the case where a provider streams an answer and
#: then sends no usage frame at all. Not a measurement — 4 is the ratio a
#: byte-pair tokenizer averages on English prose, and Indic scripts run well
#: below it, so this UNDERSTATES those. It exists because the alternative is
#: logging a call we were certainly billed for at exactly $0.00, which is the
#: fault Task 2 above is about. A row priced this way is approximate; a row
#: priced at zero is wrong.
_CHARS_PER_TOKEN = 4

#: Strong references to the detached accounting tasks in `_record_abandoned`.
#: `asyncio` keeps only a weak one, so a task nothing else holds can be
#: collected before it has written its row.
_DETACHED: set = set()


async def _stream_openai_compat(
    api_key: str, base_url: str, model: str, prompt: str,
    system: str = "", max_tokens: int = 2048,
) -> AsyncIterator[tuple[str, object]]:
    """Yield `("delta", text)` per token, then exactly one `("usage", dict)`.

    The usage frame is yielded even when it is empty, so the caller always gets
    a terminator and never has to guess whether the stream ended or stalled.

    `stream_options.include_usage` is the OpenAI-standard ask for a final frame
    carrying token counts, and both providers this reaches — OpenRouter and
    Groq — implement it. OpenRouter puts its own `cost` in that same object,
    which is the actual invoiced figure and beats anything MODEL_PRICING can
    estimate; Groq sends counts only, so Groq calls are priced from the table.
    """
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        # Without this some proxies buffer the whole response and hand it over
        # in one piece, which turns a stream back into the blocking call it was
        # meant to replace — with no error to say so.
        "Accept": "text/event-stream",
    }

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7,
        "stream": True,
        "stream_options": {"include_usage": True},
    }

    usage: dict = {}
    generation_id = ""

    async with httpx.AsyncClient(timeout=STREAM_TIMEOUT) as client:
        async with client.stream(
            "POST", f"{base_url}/chat/completions", json=payload, headers=headers,
        ) as resp:
            if resp.status_code >= 400:
                # The body has to be read explicitly on a streamed response, and
                # it is worth reading: the fallback loop below decides whether a
                # failure is retryable by looking for "429"/"403" in the error
                # string, and `raise_for_status` alone would give it only a
                # status line with no provider message in it.
                detail = (await resp.aread())[:300].decode("utf-8", "replace")
                raise httpx.HTTPStatusError(
                    f"{resp.status_code} from {base_url}: {detail}",
                    request=resp.request, response=resp,
                )

            async for line in resp.aiter_lines():
                if not line or line.startswith(":"):
                    continue          # keep-alive comment, per the SSE spec
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    frame = json.loads(data)
                except ValueError:
                    # A malformed frame is one lost token, not a lost answer.
                    continue
                if not generation_id and frame.get("id"):
                    generation_id = str(frame["id"])
                if frame.get("usage"):
                    usage = dict(frame["usage"])
                for choice in frame.get("choices") or []:
                    piece = (choice.get("delta") or {}).get("content") or ""
                    if piece:
                        yield "delta", piece

    if generation_id:
        usage.setdefault("id", generation_id)
    yield "usage", usage


def _usage_to_result(model: str, text: str, system: str, prompt: str, usage: dict) -> dict:
    """The same six keys `_call_openai_compat` returns, out of a usage frame."""
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)

    if not prompt_tokens and not completion_tokens:
        # No usage frame arrived. See `_CHARS_PER_TOKEN`: approximate rather
        # than log a billed call at zero.
        prompt_tokens = (len(system) + len(prompt)) // _CHARS_PER_TOKEN
        completion_tokens = len(text) // _CHARS_PER_TOKEN
        log.info(
            "%s streamed %d characters and reported no usage; token counts "
            "and cost for this row are approximate.", model, len(text),
        )

    cost = usage.get("cost")
    if cost is None:
        cost = usage.get("total_cost")
    cost_usd = float(cost) if cost is not None else _estimate_cost(
        model, prompt_tokens, completion_tokens,
    )

    return {
        "text": text,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": cost_usd,
        "generation_id": str(usage.get("id") or ""),
    }


async def _record_generation(
    pool, *, code: str, model: str, client_id, org_id,
    result: dict, latency_ms: int, cost_usd: float,
) -> None:
    """The `hub_ai_logs` row, and the org's daily call counter.

    ONE function, called by both `generate()` and `generate_stream()`. They used
    to be one code path and are now two, and the invariant the streaming
    contract names — the log row happens exactly once per answer, exactly as the
    non-streaming path writes it — is only true if there is one place that
    writes it. Drift here would show up as a spend report that is right for
    whichever half of the traffic streams.

    `org_id` as well as `client_id`. Every TEXT generation was written with
    neither: the org routes reach this function without a client (there is no
    `hub_clients` row behind `/org/generate`), and the column was simply never
    passed. Measured 2026-07-29 over 21 calls — 18 landed with `org_id` NULL and
    only the three IMAGE rows, which go through `generate_image` and do pass it,
    were attributable.

    `hub_ai_logs` is the only place a call's provider, model, tokens, latency
    and USD cost are recorded, so an org's entire text spend was unattributable
    to it — and `GET /hub/analytics/spend`, which is org-scoped, could only ever
    report the images.
    """
    await pool.execute(
        "INSERT INTO public.hub_ai_logs "
        "(client_id, org_id, provider, model, prompt_tokens, completion_tokens, "
        " latency_ms, status, cost_usd, generation_id) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'success', $8, $9)",
        client_id, org_id, code, model,
        result["prompt_tokens"], result["completion_tokens"],
        latency_ms, cost_usd, result.get("generation_id", ""),
    )
    if client_id:
        _org_id = await pool.fetchval(
            "SELECT org_id FROM public.hub_clients WHERE id=$1::uuid", client_id
        )
        if _org_id:
            await pool.execute(
                "INSERT INTO public.usage_tracking (org_id, metric, value, recorded_at) "
                "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
                "ON CONFLICT (org_id, metric, recorded_at) "
                "DO UPDATE SET value = public.usage_tracking.value + 1",
                _org_id,
            )


async def _record_failure(pool, *, code, model, client_id, org_id, latency_ms, error) -> None:
    """The error row. The failures matter as much as the successes: a provider
    ahead of the working one in the chain charges every call its round trip.
    Two of them were 400ing on every request as of 2026-07-29."""
    await pool.execute(
        "INSERT INTO public.hub_ai_logs "
        "(client_id, org_id, provider, model, latency_ms, status, error_message) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'error', $6)",
        client_id, org_id, code, model, latency_ms, str(error)[:500],
    )


def _record_abandoned(pool, **kw) -> None:
    """Log a generation the reader walked away from, without awaiting it.

    ── WHAT HAPPENS WHEN THE CLIENT DISCONNECTS MID-STREAM ──────────────────

    The provider has already produced — and billed us for — the tokens it sent
    before the socket closed. Three decisions, and each is pinned by a test in
    `tests/test_sahayak_stream.py`:

      1. THE ROW IS STILL WRITTEN. Cost we were charged has to reach
         `hub_ai_logs` or the spend report is wrong in the one direction that
         matters. It cannot be awaited: the task is already being cancelled, so
         every `await` on this stack raises immediately. It is detached instead
         and allowed to finish on its own.
      2. THE CREDIT IS NOT REFUNDED. `routers/hub.py` charges before the model
         runs; a refund on disconnect would make closing the tab a way to read
         an answer for free, and we were billed either way.
      3. NOTHING IS STORED AS AN ANSWER. The half a reader saw is not written to
         `hub_chat_messages` — see invariant 4 of the streaming contract. The
         question stays in the history with no reply under it, which is what
         actually happened.

    If the event loop is already gone there is nowhere to run it; that is logged
    and dropped rather than raised, because raising here would replace a lost
    log row with a lost cancellation.

    NOT `server._bg`, which does the same job with the same caveats: `server`
    imports the routers, which import this module, so reaching for it here is an
    import cycle. The reference-keeping below is the half of `_bg` that is not
    optional — a task held by nothing may be collected before it runs, which
    would turn "detached" into "sometimes".
    """
    async def _run() -> None:
        try:
            await _record_generation(pool, **kw)
        except Exception as exc:                      # noqa: BLE001 — logged
            log.warning("Abandoned %s call not logged: %s", kw.get("code"), exc)

    try:
        task = asyncio.get_running_loop().create_task(_run())
    except RuntimeError:                              # pragma: no cover — shutdown
        log.warning("Stream abandoned during shutdown; %s call not logged.",
                    kw.get("code"))
        return
    _DETACHED.add(task)
    task.add_done_callback(_DETACHED.discard)


async def _gemini_answer(
    api_key: str, base_url: str, prompt: str, system: str = "",
    max_tokens: int = 2048, *, task: str = "content",
) -> dict:
    """The direct-Gemini call and its grounding retry. ONE copy, two callers.

    `generate()` and `generate_stream()` both reach the `gemini` provider, and
    this branch is the only place in this module where the two could answer the
    same question differently — everything else about them is provider-agnostic.
    The streaming half used to hardcode `grounded=False` and the text model, so
    the moment `gemini` was named by the chatbot chain again `POST /chat` would
    have returned a populated `grounding_sources` list and `POST /chat/stream`
    an empty one for the identical question — and `strip_invalid_refs` would
    then have deleted every web citation the streamed answer wrote, because the
    sources backing them were never handed over. That is the drift the "one
    pipeline" comment in `routers/hub.py` is defending against, one layer down.

    UNREACHABLE TODAY: `_select_providers` names `gemini` in no chain (see its
    docstring, 2026-08-16). Kept whole for the same reason `_call_gemini` is —
    it is the only code that can attach `tools: [{google_search: {}}]`, and
    re-arming it must not also mean rediscovering this retry.
    """
    # TASK, not agent_type. Nothing in the product passed `task="chatbot"` to
    # `generate` until 2026-08-05 — the chat router passed
    # `agent_type="chatbot"` and no task at all — so this was `False` on every
    # call ever made and web grounding, which is the whole reason the chatbot
    # chain led with Gemini direct, had never once been switched on for a
    # user's question.
    use_grounding = task == "chatbot"
    # PINNED, not the provider row's `default_model`. See GEMINI_TEXT_MODEL for
    # why nothing here is allowed to be a `-latest` alias.
    gm = GEMINI_GROUNDING_MODEL if use_grounding else GEMINI_TEXT_MODEL
    try:
        return await _call_gemini(api_key, base_url, gm, prompt, system, max_tokens, grounded=use_grounding)
    except Exception as exc:                            # noqa: BLE001 — narrowed below
        # GROUNDING IS BILLED SEPARATELY FROM GENERATION, and the Gemini FREE
        # TIER does not include it. Measured 2026-08-08 against the same key,
        # same model, one request apart: a plain `generateContent` answered 200
        # and the identical call carrying `tools:[{google_search:{}}]` answered
        # 429 RESOURCE_EXHAUSTED.
        #
        # Without this, that 429 costs the whole PROVIDER: the chain falls
        # through to Qwen, so an org on the free tier loses Gemini's Indic
        # quality for every chat message to buy a web search it was never going
        # to get. Retrying ungrounded keeps the model and loses only the search.
        #
        # Narrow on purpose. Only a grounded call, and only a quota/permission
        # refusal — 429 and 403. A 500 or a timeout is Gemini being down, and
        # retrying that here would just double the wait before the chain does
        # its job.
        text = str(exc)
        retryable = use_grounding and ("429" in text or "403" in text
                                       or "RESOURCE_EXHAUSTED" in text
                                       or "PERMISSION_DENIED" in text)
        if not retryable:
            raise
        log.warning(
            "Gemini refused the grounded call (%s). Retrying WITHOUT "
            "web search — the answer will be ungrounded.", text[:120],
        )
        # Back to the CHEAP text model. The grounded attempt is what justified
        # the pricier one; without search there is no reason to pay for it on
        # the retry.
        result = await _call_gemini(api_key, base_url, GEMINI_TEXT_MODEL, prompt, system, max_tokens, grounded=False)
        # Said out loud rather than inferred from an empty source list: a caller
        # cannot otherwise tell "searched and found nothing" from "never
        # searched".
        result["grounding_degraded"] = True
        return result


async def generate_stream(
    prompt: str,
    system: str = "",
    client_id: Optional[str] = None,
    max_tokens: int = 2048,
    language: str = "en",
    agent_type: str = "social_media",
    task: str = "content",
    org_id: Optional[str] = None,
) -> AsyncIterator[tuple[str, object]]:
    """`generate()`, delta by delta. Yields `("delta", str)` then `("final", dict)`.

    The `final` dict is the same shape `generate()` returns — text, provider,
    model, tokens, cost_usd, grounding_sources — so a caller can hand it to code
    written for the blocking path without translating anything.

    ── FALLBACK STOPS AT THE FIRST DELTA ────────────────────────────────────

    `started` is the whole rule. Until one token has been yielded to the caller
    nothing has been shown to anybody, so a provider failure is invisible and
    the chain moves on exactly as `generate()` does. After that it is not
    invisible: the reader is watching a paragraph appear, and silently switching
    providers would rewrite text they have already read — the answer would
    change under them mid-sentence, with no way to tell that it had. So once
    `started` is true a failure ends the stream, and the caller turns it into
    the `error` event the streaming contract names.

    That is also why the chain is walked in the same order as `generate()`
    rather than being reordered to put the most reliable provider first: the
    cheap model still answers the vast majority of questions, and the cost of
    its rare failure is one wasted round trip BEFORE any token was sent.
    """
    all_providers = await _get_providers()
    pool = await get_pool()
    last_error = None
    started = False

    provider_order = _select_providers(language, agent_type, task)

    for code in provider_order:
        prov = all_providers.get(code)
        if not prov:
            continue

        env_key = _PROVIDER_KEYS.get(code)
        api_key = os.getenv(env_key, "") if env_key else ""
        if not api_key:
            continue

        model = prov["default_model"]
        start = time.monotonic()
        chunks: list[str] = []
        usage: dict = {}
        settled = False       # has this attempt written its own log row

        try:
            if code == "gemini":
                # The direct Gemini provider is named by no chain today (see
                # `_select_providers`) and its `generateContent` endpoint is not
                # the OpenAI SSE shape. Rather than leave a hole should it ever
                # be re-armed, it answers in one piece and that whole answer is
                # yielded as a single delta: slower to appear, identical to
                # read, and correct on every other count.
                #
                # `_gemini_answer`, which is the call `generate()` makes —
                # grounding decision, pinned model and ungrounded retry
                # included. Written out a second time here it lost all three,
                # and the two endpoints would have answered one question two
                # different ways the day the chain named `gemini` again.
                blocking = await _gemini_answer(
                    api_key, prov["api_base_url"], prompt, system, max_tokens,
                    task=task,
                )
                if blocking["text"]:
                    chunks.append(blocking["text"])
                    started = True
                    yield "delta", blocking["text"]
                result = blocking
            else:
                async for kind, value in _stream_openai_compat(
                    api_key, prov["api_base_url"], model, prompt, system, max_tokens,
                ):
                    if kind == "usage":
                        usage = value if isinstance(value, dict) else {}
                        continue
                    chunks.append(str(value))
                    started = True
                    yield "delta", value
                result = _usage_to_result(model, "".join(chunks), system, prompt, usage)

            latency = int((time.monotonic() - start) * 1000)
            cost_usd = result.get("cost_usd", 0.0)
            await _record_generation(
                pool, code=code, model=model, client_id=client_id, org_id=org_id,
                result=result, latency_ms=latency, cost_usd=cost_usd,
            )
            settled = True

            yield "final", {
                "text": result["text"],
                "provider": code,
                "model": model,
                "prompt_tokens": result["prompt_tokens"],
                "completion_tokens": result["completion_tokens"],
                "cost_usd": cost_usd,
                "grounding_sources": result.get("grounding_sources", []),
            }
            return

        except Exception as e:                        # noqa: BLE001 — logged, then chained
            latency = int((time.monotonic() - start) * 1000)
            last_error = e
            settled = True
            log.warning("AI provider %s failed while streaming: %s", code, e)
            await _record_failure(
                pool, code=code, model=model, client_id=client_id, org_id=org_id,
                latency_ms=latency, error=e,
            )
            if started:
                # Invariant 2. Tokens are already on the reader's screen.
                raise
            continue

        finally:
            if not settled:
                # Neither success nor failure got as far as writing a row, which
                # leaves exactly one cause: this generator was closed from the
                # outside — the reader's connection went away — while the
                # provider was mid-answer. See `_record_abandoned`.
                partial = _usage_to_result(model, "".join(chunks), system, prompt, usage)
                _record_abandoned(
                    pool, code=code, model=model, client_id=client_id, org_id=org_id,
                    result=partial,
                    latency_ms=int((time.monotonic() - start) * 1000),
                    cost_usd=partial["cost_usd"],
                )

    raise RuntimeError(f"All AI providers failed. Last error: {last_error}")


async def generate(
    prompt: str,
    system: str = "",
    client_id: Optional[str] = None,
    max_tokens: int = 2048,
    language: str = "en",
    agent_type: str = "social_media",
    task: str = "content",
    org_id: Optional[str] = None,
) -> dict:
    """Generate text using smart provider routing.
    Routes based on language (Indic → Gemini family), task type (quality → Qwen),
    and falls back through the chain on failure.

    Returns {"text", "provider", "model", "prompt_tokens", "completion_tokens",
    "cost_usd", "grounding_sources"}.

    `grounding_sources` is a list of {"title", "url"} and is only ever non-empty
    for `task="chatbot"`, which is the one task that turns Google Search
    grounding on. It is present and empty on every other path so that callers
    never have to test which provider answered.

    NOTE ON `task` vs `agent_type`: routing branches on TASK. `agent_type` picks
    quality/premium tiers within a task. A caller that means "this is the
    chatbot" must pass `task="chatbot"` — `agent_type="chatbot"` reaches no
    branch in `_select_providers` at all and silently lands on the English bulk
    chain. That was true of every chat answer this product gave until 2026-08-05.
    """
    all_providers = await _get_providers()
    pool = await get_pool()
    last_error = None

    provider_order = _select_providers(language, agent_type, task)

    for code in provider_order:
        prov = all_providers.get(code)
        if not prov:
            continue

        env_key = _PROVIDER_KEYS.get(code)
        api_key = os.getenv(env_key, "") if env_key else ""
        if not api_key:
            continue

        model = prov["default_model"]
        start = time.monotonic()

        try:
            if code == "gemini":
                result = await _gemini_answer(
                    api_key, prov["api_base_url"], prompt, system, max_tokens,
                    task=task,
                )
            else:
                result = await _call_openai_compat(api_key, prov["api_base_url"], model, prompt, system, max_tokens)

            latency = int((time.monotonic() - start) * 1000)
            cost_usd = result.get("cost_usd", 0.0)

            # `_record_generation`, not an inline INSERT. `generate_stream()`
            # has to write the identical row for the identical answer, and two
            # copies of an INSERT is how the streaming half of the traffic ends
            # up missing from a spend report that the blocking half is right
            # about. The comment explaining what the row is for moved with it.
            await _record_generation(
                pool, code=code, model=model, client_id=client_id, org_id=org_id,
                result=result, latency_ms=latency, cost_usd=cost_usd,
            )

            return {
                "text": result["text"],
                "provider": code,
                "model": model,
                "prompt_tokens": result["prompt_tokens"],
                "completion_tokens": result["completion_tokens"],
                "cost_usd": cost_usd,
                # `_call_gemini` collects these out of `groundingMetadata` and
                # returns them under `grounding_sources`; this dict listed six
                # keys and dropped them on the floor. So a grounded answer —
                # paid for, and answered out of live web results — arrived at
                # the chat layer indistinguishable from an ungrounded one, with
                # nothing to cite. `routers/hub_chat.py` has read
                # `ai_result["grounding_sources"]` the whole time and has always
                # got `[]`.
                #
                # `.get` with a default rather than `result["…"]`, because
                # `_call_openai_compat` — every provider that is not Gemini
                # direct — does not produce the key at all. Defaulting here is
                # what keeps the return shape identical for all of them, so no
                # caller has to branch on which provider answered.
                "grounding_sources": result.get("grounding_sources", []),
            }

        except Exception as e:
            latency = int((time.monotonic() - start) * 1000)
            last_error = e
            log.warning("AI provider %s failed: %s", code, e)
            await _record_failure(
                pool, code=code, model=model, client_id=client_id, org_id=org_id,
                latency_ms=latency, error=e,
            )

    raise RuntimeError(f"All AI providers failed. Last error: {last_error}")


# ── Image Generation ─────────────────────────────────────────
#
# WHAT THE MODEL WAS ACTUALLY BEING ASKED FOR, until 2026-08-19.
#
#     "Create a professional image for: " + prompt[:200]
#
# That is the whole brief. The skill's own description — the sentence the user
# wrote, the festival, the firm, the service being explained — was cut at two
# hundred characters and hidden behind a prefix that describes nothing. No
# subject, no composition, no lighting, no palette, no negative guidance ever
# reached the model. Every generic, plastic, faintly-wrong picture this product
# has ever produced came out of that one line.
#
# `style` made it worse by looking like it worked: `generate_image` has always
# taken the argument and no branch has ever read it.
#
# THE ORDERING PRINCIPLE. Measured 2026-08-19 against the org's own keys, one
# brief, five models: the prompt moves the picture further than the price tier
# does. So the effort goes into the brief — which costs a fraction of a cent —
# the ladder leads with the cheapest model that is genuinely good, and the
# dearer models sit behind it as fallbacks rather than as the default. What the
# product did before was the exact inverse: a 200-character prompt on a lite
# model, with FLUX.2 Pro parked behind a dead step it could never be reached
# through.
#
# THE LADDER — `_IMAGE_LADDER`, one order for every preset — and what each
# step is for. It descends into the cheap before it climbs into the dear:
#
#   1. fal-ai FLUX.1 dev  — the lead. ~$0.025, 1.7–6.6 s measured. It holds a
#      long compositional brief, which is what this path now sends, and it is
#      the only step that takes true pixel DIMENSIONS, so an aspect ratio
#      arrives as a frame rather than as a hint. That it beats the rung below
#      it on picture quality is the ONE judgement here that has not been
#      measured on these briefs — see `_FAL_ROUTES`, which says so rather than
#      claiming otherwise.
#   2. fal-ai FLUX.1 schnell — the first fallback, and CHEAPER than the lead at
#      roughly a tenth the price. Measured 2026-08-19 on the same key: 200 in
#      2,158 ms. The rung after the lead used to be a $0.040 model, so a lead
#      that was merely throttled sent an entire run of images to a dearer one;
#      Aekam absorbs that out of a flat INR subscription. A transient failure
#      is now retried on the lead first and falls to a cheaper family member
#      second, and only then to anything paid.
#   3. Recraft V4         — $0.040. It is the only model measured that set
#      "Sharma & Associates / Chartered Accountants | Ahmedabad" letter-perfect,
#      and it used to LEAD for the typographic presets on that strength. It no
#      longer does: nothing asks a model to draw a word any more, so the
#      product's most-posted image stopped paying 60% extra for a skill it is
#      not being asked to use. See `_build_image_prompt`.
#   4. FLUX.2 Pro         — the top photographic tier and the dearest at
#      $0.045, so it stands behind everything that is as good for less.
#   5. Gemini 3.1 Flash Lite Image — last, and this is the demotion that
#      matters. It was the DEFAULT: the HuggingFace step above it had been
#      answering `410 Gone` since its serverless route for FLUX.1-dev was
#      retired, so every image in this product came from a lite model while
#      FLUX.2 Pro sat unreachable behind it. It stays in the ladder because it
#      is fast, and because it is the only model measured that rendered
#      Devanagari correctly — but it typesets stray words out of its own
#      instructions into the picture, and at $0.034 it is dearer than the lead.
#   6. Gemini native      — unchanged, and still behind GEMINI_IMAGE_ENABLED.
#
# The dead step, for the record: `hf-inference` answers 410 with "the requested
# model is deprecated and no longer supported by provider hf-inference" for
# every image model. `nebius` 404s and `together` 403s on the same key. The
# fal-ai provider route on the same HuggingFace router answers 200 in about two
# seconds, which is why step 1 is that and nothing else.

#: A remote URL is not a promise about size.
#:
#: The fal step is the first place in this codebase that fetches an image from a
#: URL a third party named, rather than receiving bytes inline. `httpx.get(url)`
#: would buy whatever is at the other end before anything could refuse it —
#: which is the same bug as the 500 MB e-sign POST that was resident in the
#: worker before a 20 MB check rejected it (see `storage.read_capped`). There
#: are two gunicorn workers on a 2 GB container. A 1 MP PNG is 1–3 MB; twelve is
#: room for a mistake and not room for an outage.
_MAX_IMAGE_BYTES = 12 * 1024 * 1024
_IMAGE_CHUNK = 256 * 1024

#: And the fetch only ever goes to fal's own CDN. The URL arrives inside a JSON
#: body, so it is provider-controlled input; restricting the host costs nothing
#: and means a compromised or confused response cannot point this server at an
#: arbitrary address. Observed host 2026-08-19: `v3b.fal.media`. If fal moves
#: its CDN both fal rungs start failing over to Recraft — noisily, in the log,
#: and expensively: fal bills at generation, so each refusal here is a picture
#: already paid for. That is why the refusal carries its price out with it, and
#: why this tuple is worth checking first when image spend jumps.
_FAL_HOSTS = ("fal.media", "fal.run", "fal.ai")

#: What the bytes actually are. The old upload path named every file `.png` and
#: sent `content_type="image/png"` whatever came back, and only one of the four
#: providers returns PNG: measured 2026-08-19, Recraft V4 answers `image/webp`,
#: Gemini `image/jpeg`, and fal defaults to JPEG unless asked. So R2 has been
#: holding WebP and JPEG under a `.png` name with a lying content type.
_EXT_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
}

#: Aspect ratio → pixels, at roughly one megapixel, every side a multiple of 16.
#:
#: A 1:1 square posted to LinkedIn is a crop, and `quick_generate` — the route
#: the Generate tab uses — passes no ratio at all, so every image it has ever
#: made was square by default. Both halves of that are fixed: the presets carry
#: a sensible default frame, and the ratio now reaches the model.
#:
#: The multiple of 16 is not decoration. fal rounds to it regardless — asking
#: for 1080x1350 returned 1072x1344 — so the rounding is done here where it can
#: be read, rather than silently at the far end.
_ASPECT_DIMS: dict[str, tuple[int, int]] = {
    "1:1": (1024, 1024),        # Instagram square, the safe default
    "4:5": (896, 1120),         # Instagram portrait — the feed's best real estate
    "5:4": (1120, 896),
    "3:4": (864, 1152),
    "4:3": (1152, 864),
    "2:3": (832, 1216),
    "3:2": (1216, 832),
    "9:16": (768, 1344),        # story / reel
    "16:9": (1344, 768),        # LinkedIn, X, blog hero
    "1.91:1": (1216, 640),      # link preview / OG card
}

#: The frames the OpenRouter rungs will actually accept.
#:
#: OpenRouter validates `aspect_ratio` against a PER-MODEL allowlist and answers
#: 400 rather than picking something near. Measured 2026-08-19, live:
#:
#:   recraft/recraft-v4            1:1, 4:3, 3:4, 16:9, 9:16
#:   black-forest-labs/flux.2-pro  1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16, 21:9
#:   gemini-3.1-flash-lite-image   accepts 4:5, which neither of the others does
#:
#: and the endpoint's own schema rejects anything outside a fixed enum before a
#: provider is even reached — "1.91:1" comes back as a ZodError. This is not
#: theoretical: `festival_greeting` defaults to 4:5 and, while it still led with
#: Recraft, 400d on its own lead the first time the real ladder was driven.
#:
#: So this is the INTERSECTION, one list for all three rungs rather than three
#: that can drift apart, and every requested frame is snapped into it. 4:5
#: becomes 3:4 — 0.80 against 0.75, which nobody looking at an Instagram post
#: can see, and which is a portrait rather than a failure.
#:
#: The lead rung is unaffected and keeps the exact pixels: fal takes real
#: dimensions, so `_ASPECT_DIMS` above is delivered as asked whenever step one
#: answers, which is most of the time.
_OPENROUTER_RATIOS: tuple[str, ...] = ("1:1", "4:3", "3:4", "16:9", "9:16")


def _openrouter_ratio(ratio: str) -> str:
    """Nearest frame an OpenRouter image model will accept.

    Nearest in LOG space, so that 4:3 and 3:4 sit the same distance from square
    and a portrait brief can never snap to a landscape frame.
    """
    import math

    w, h = _aspect_dims(ratio)
    target = math.log(w / h)
    return min(
        _OPENROUTER_RATIOS,
        key=lambda k: abs(math.log(_ASPECT_DIMS[k][0] / _ASPECT_DIMS[k][1]) - target),
    )

#: The AI-slop signature, in one list, led by the thing that gives it away.
#:
#: Garbled lettering is the single most recognisable tell — a viewer who cannot
#: name a single other artefact will read "Sharna & Associates" and know. Hands
#: and waxy skin are next, and matter here because `team_card` is a photograph
#: of people.
_GLOBAL_AVOID = (
    "garbled or misspelt text, invented letterforms, nonsense lettering, "
    "warped logos, watermarks, signatures, extra or fused fingers, deformed "
    "hands, uncanny faces, waxy plastic skin, blown-out HDR glow, duplicated "
    "or floating objects, low-resolution artefacts"
)

#: What every picture has to get right whatever it is of.
#:
#: NOT "professional colour grading", which this line carried until the slop
#: ratchet was pointed at the string that actually leaves the process rather
#: than at the composed brief alone. "professional" is the FIRST entry in
#: `image_brief.SLOP_WORDS` and the reason that list exists: it describes
#: nothing a camera or a hand could do differently, so the model resolves it to
#: the mean of its training set, which is the look the owner complained about.
#: Every image from every route was shipping it — and on the composed paths the
#: brief's own counter-instruction, its Avoid line, is the last thing in the
#: budget and is usually dropped before it gets here.
#:
#: "the subject in focus" rather than "sharp focus" for a second reason: three
#: of the six presets ask for shallow depth of field or a soft background, and
#: a frame-wide sharpness order on top of them is two directions fighting, not
#: one direction repeated.
_QUALITY_SPINE = (
    "the subject in focus, one coherent light source, correct anatomy and "
    "perspective, true-to-life colour, clean edges"
)

#: How much of the caller's own brief survives.
#:
#: 700 characters, not 200, and the number is derived rather than chosen: FLUX
#: encodes with T5 at a 512-token ceiling — roughly 2,000 characters — and the
#: scaffolding below is about 1,100 of them. The subject goes FIRST for the same
#: reason, so that if anything is dropped at the encoder it is the tail of the
#: avoid list and never the thing the user asked for.
_SUBJECT_LIMIT = 700


# ── The presets, and what an Indian accountancy or consulting firm posts ──────
#
# `typographic` marks the presets whose picture is BUILT AROUND lettering — a
# greeting card with a headline, an explainer with a label. It reserves a clean
# band for that headline. It does NOT ask for the headline: no preset here asks
# any model to draw a word, because none of them can, and because
# `image_brief.HOUSE_AVOID` opens by banning lettering outright — a rule the
# router used to contradict on exactly the presets it matters most on. See
# `_build_image_prompt`.
#
# No direction below may use a word from `image_brief.SLOP_WORDS`. Two did:
# both said "professional services firm", which reads as an industry to a human
# and as the mean of the training set to a text encoder. They name the office
# instead. `tests/test_image_brief.py` scans the assembled prompt for the whole
# list, so this cannot drift back silently.
_IMAGE_PRESETS: dict[str, dict] = {
    "auto": {
        "ratio": "1:1",
        "typographic": False,
        "direction": (
            "clean modern corporate visual in an Indian business context, one "
            "clear subject, uncluttered composition, soft natural light, "
            "restrained palette, generous negative space"
        ),
        "avoid": "no busy collage, no clip-art, no generic gradient background",
    },
    "festival_greeting": {
        # Diwali, Holi, Ganesh Chaturthi, Independence Day — the firm's most
        # posted image by a distance, and the one most often ruined by text.
        "ratio": "4:5",
        "typographic": True,
        "direction": (
            "festive Indian greeting card, editorial poster layout with a clear "
            "uncluttered band across the upper third for a headline, warm brass "
            "diyas, marigold garland, subtle rangoli geometry, soft paper "
            "texture, rich saturated colour, soft directional light"
        ),
        "avoid": (
            "no crowded collage, no clip-art fireworks, no stock-photo faces, "
            "no deity depicted inaccurately"
        ),
    },
    "service_explainer": {
        # "What is a GST return", "How TDS works" — a diagram card, not a photo.
        "ratio": "1:1",
        "typographic": True,
        "direction": (
            "clean explanatory graphic for an Indian accountancy or consulting "
            "firm, flat vector illustration, one clear focal object, generous "
            "white space, "
            "restrained two-colour accent palette on an off-white ground, even "
            "line weight, consistently front-on or consistently isometric, room "
            "at the top for a headline"
        ),
        "avoid": (
            "no dense infographic charts, no invented dashboard numbers, no "
            "arrows pointing nowhere, no gradient mesh, no mixed perspectives"
        ),
    },
    "team_card": {
        # Hiring posts, "meet the team", office culture.
        "ratio": "4:5",
        "typographic": False,
        "direction": (
            "documentary photograph of a real Indian accountancy or consulting "
            "office, Indian faces, natural window light, working desks with actual "
            "papers, muted corporate palette, 35mm lens, candid posture, "
            "shallow background blur"
        ),
        "avoid": (
            "no glossy Western stock photography, no handshake cliché, no "
            "boardroom with an implausible skyline, no rictus smiles"
        ),
    },
    "product_shot": {
        # A deliverable, a document, an app screen, a physical thing.
        "ratio": "1:1",
        "typographic": False,
        "direction": (
            "studio product photograph on a seamless neutral sweep, single soft "
            "key light with gentle fill, controlled specular highlights, "
            "true-to-life material texture, centred hero framing, shallow depth "
            "of field"
        ),
        "avoid": (
            "no floating props, no rainbow reflections, no lens flare, no "
            "impossible object geometry"
        ),
    },
    "blog_hero": {
        # The wide banner above an article. The headline is typeset in HTML over
        # it, which is why this one is not `typographic` — it needs SPACE, not
        # lettering.
        "ratio": "16:9",
        "typographic": False,
        "direction": (
            "wide editorial hero image for an article, one strong concept, "
            "generous empty space across the left third for an overlaid "
            "headline, restrained muted palette, cinematic soft light, "
            "magazine-cover composition"
        ),
        "avoid": (
            "no busy background, no centred subject fighting the headline "
            "space, no text baked into the image"
        ),
    },
}

#: The skill names the hub routes already use, pointed at the preset that suits
#: them. A caller that passes its own skill straight through gets a real brief
#: instead of falling to `auto`, and nothing has to be kept in step by hand.
_STYLE_ALIASES = {
    "social_post": "auto",
    "social_media": "auto",
    "ad_copy": "product_shot",
    "festival_campaign": "festival_greeting",
    "festival": "festival_greeting",
    "email_campaign": "blog_hero",
    "blog_post": "blog_hero",
    "blog": "blog_hero",
    "explainer": "service_explainer",
    "team": "team_card",
    "product": "product_shot",
}


def _resolve_preset(style: str) -> tuple[str, dict]:
    """Preset name and body for whatever the caller passed.

    Unknown values fall to `auto` rather than raising: `style` reaches this from
    a skill template's JSON, and a picture that is merely un-specialised beats a
    500 on a route the customer has already been charged for.
    """
    key = (style or "auto").strip().lower()
    key = _STYLE_ALIASES.get(key, key)
    if key not in _IMAGE_PRESETS:
        key = "auto"
    return key, _IMAGE_PRESETS[key]


def _has_non_latin_script(text: str) -> bool:
    """Does the brief carry Indic lettering the model would be asked to draw?

    Not `detect_language`, and deliberately not: that function needs a 20% share
    of the letters before it calls a message Indic, which is right for routing a
    conversation and wrong here. "Diwali card saying शुभ दीपावली" is four Indic
    words in an English sentence — under the floor, and the exact case that has
    to be caught.
    """
    return any(
        lo <= ord(ch) <= hi
        for ch in (text or "")
        for lo, hi, _code in _SCRIPT_RANGES
    )


def _aspect_dims(ratio: str) -> tuple[int, int]:
    """Pixels for a ratio, for the one provider that takes real dimensions.

    Clamped, because `aspect_ratio` arrives from a request body: "1:10000" is a
    valid string and a degenerate canvas. Sides are held between 512 and 1536
    and the ratio itself between 1:4 and 4:1, which covers every frame any
    social surface accepts and refuses the ones that only waste a generation.
    """
    key = (ratio or "1:1").strip()
    if key in _ASPECT_DIMS:
        return _ASPECT_DIMS[key]

    try:
        left, right = key.split(":", 1)
        w, h = float(left), float(right)
        if w <= 0 or h <= 0:
            raise ValueError(key)
        r = max(0.25, min(4.0, w / h))
    except (ValueError, ZeroDivisionError):
        return _ASPECT_DIMS["1:1"]

    # ~1 MP at the requested shape, then snapped to the multiple of 16 the
    # provider is going to snap to anyway.
    import math

    side = math.sqrt(1024 * 1024 / r)
    height = int(max(512, min(1536, round(side / 16) * 16)))
    width = int(max(512, min(1536, round(height * r / 16) * 16)))
    return width, height


#: The fingerprint of a brief that arrived with its own art direction.
#:
#: `_lead()` in `services/image_brief.py` opens every composed brief with
#: "A <medium>, for an Indian business, about: …" and then one labelled line per
#: decision. The labels are matched as a fallback because the budget there drops
#: whole lines from the END, so the lead is the part that cannot be missing.
_COMPOSED_LEAD = ", for an Indian business"
_COMPOSED_LABELS = (
    "Subject:", "Composition:", "Colour:", "Lighting:", "Setting:", "Mood:",
)


def _is_art_directed(brief: str) -> bool:
    """Does this brief already say what the picture looks like?

    Measured 2026-08-19 on the Festival Calendar template, whose composed brief
    reaches here carrying its own medium, composition and light. The preset's
    line was appended on top of all three, and the result asked one model for
    two pictures at once:

        "A rich still-life photograph, fine grain … Composition: symmetrical
        border framing an empty middle; dead overhead, square. Lighting:
        low-key, lit almost entirely by the diya flames …
        Composition and style: festive Indian greeting card, editorial poster
        layout with a clear uncluttered band across the upper third …, soft
        paper texture, …, soft directional light."

    A still-life shot from overhead by candlelight and a flat printed card lit
    softly from one side are not the same photograph, and a text encoder given
    both averages them — which is the look this whole path exists to stop. So
    the more specific brief wins and the preset keeps only what is genuinely a
    router-side fact: the frame, the ladder, the lettering rule and the
    negatives, none of which the composing module decides.

    A brief the customer typed by hand carries none of this and still gets the
    preset's direction, which is the case that was already working.
    """
    text = brief or ""
    if _COMPOSED_LEAD in text:
        return True
    # Whitespace is already collapsed by the time this is called, so the labels
    # are matched as substrings rather than at line starts.
    return sum(1 for label in _COMPOSED_LABELS if label in text) >= 2


def _build_image_prompt(
    brief: str,
    preset: dict,
    *,
    conversational: bool = False,
) -> str:
    """The whole brief the model actually receives.

    ── ON NEGATIVE PROMPTING, which is the point of this function ────────────
    NOT ONE MODEL IN THIS LADDER HAS A NEGATIVE PROMPT PARAMETER THAT CAN BE
    SHOWN TO DO ANYTHING, so the negatives are folded into the prompt text and
    `negative_prompt` is sent to nobody.

    Measured 2026-08-19. fal's FLUX route accepts `negative_prompt` and answers
    200 — it does not reject the key, which is worse than rejecting it, because
    it looks like it works. An A/B on a fixed seed cannot settle it either: two
    identical calls at seed 12345 returned different bytes, so the route is
    nondeterministic and there is nothing to compare. FLUX.1 is
    guidance-distilled and runs at CFG 1, which leaves a negative prompt no
    mechanism to act through in the first place. OpenRouter's images endpoint
    likewise took the key on Recraft V4 without complaint and documents no such
    field. An "Avoid:" clause in the prompt, by contrast, is read by every text
    encoder in the ladder.

    ── AND WHY GEMINI GETS A DIFFERENT STRING ────────────────────────────────
    `conversational=True` is for the Gemini image model, which is an
    instruction-following model and treats the prompt as copy as much as
    direction. Given "leave clean empty space for a headline" it typeset the
    words CLEAN SPACE into the picture, in a serif face, centred. So that
    branch opens by saying the sentences are not copy, and drops the bare
    "Avoid:" list a diffusion model wants.

    ── AND WHY THE PRESET'S OWN DIRECTION IS SOMETIMES LEFT OUT ──────────────
    A brief that arrives from `services/image_brief.py` already carries a
    Composition, a Lighting, a Colour and a medium chosen for that template.
    Appending the preset's line on top of it does not layer, it argues — see
    `_is_art_directed`.
    """
    subject = " ".join((brief or "").split())[:_SUBJECT_LIMIT]
    # The composed brief ends in a full stop and the scaffolding below adds
    # another, which put ".." in the middle of every prompt on that path.
    subject = subject.rstrip(" .")

    # ── THE LETTERING RULE, which is the anti-slop measure that actually works.
    #
    # A picture with no words in it cannot have misspelt words in it. NOTHING
    # here asks a model to spell — not even the typographic presets, which ask
    # only for the SPACE a headline will be set into afterwards.
    #
    # That clause used to read "any words must be short and correctly spelled in
    # the Latin alphabet", and it was wrong twice over. It contradicted the
    # composed brief's own first negative — `image_brief.HOUSE_AVOID` opens with
    # "any lettering, words, numerals, captions or signage inside the frame" —
    # and on the festival path that Avoid line is the last thing in the budget
    # and is dropped before it arrives, so the only surviving instruction about
    # words was the one inviting them. It also contradicted the measurement
    # directly below.
    #
    # Measured on one brief carrying "शुभ दीपावली": FLUX.2 Pro drew
    # "शुथ हिपावली", Recraft V4 drew "सुभ रीपदलीं" — both confidently, both
    # wrong, in a script the firm's own clients read. Only the lite model got it
    # right, and it garbled the English in the same frame. The one frame in the
    # whole comparison with nothing wrong with it is the one that was told not
    # to try. The headline is typeset over the image afterwards, which is what
    # the design surface does anyway, and it is the only way the copy stays
    # editable after the credit has been spent.
    if preset["typographic"]:
        lettering = (
            "leave a clean uncluttered band clear for a headline to be typeset "
            "over the image afterwards, and draw no letters, words or numerals "
            "in that band or anywhere else in the frame"
        )
    else:
        lettering = "no text, lettering, captions, logos or watermarks anywhere in the frame"

    if _has_non_latin_script(subject):
        lettering += (
            "; do not attempt Devanagari or any other Indic script — leave that "
            "area empty, the words are typeset over the image afterwards"
        )

    avoid = f"{_GLOBAL_AVOID}, {preset['avoid']}"

    # The preset's direction is a DEFAULT, not an overlay. Where the brief
    # already names a composition and a light, restating a second set of both is
    # what produced the measured contradiction in `_is_art_directed`.
    directed = _is_art_directed(subject)

    if conversational:
        lines = [
            "Generate an image. The sentences below describe the picture; none "
            "of their words are copy, so never typeset any of them into it.",
            f"Subject: {subject}",
        ]
        if not directed:
            lines.append(f"Style: {preset['direction']}.")
        lines += [
            f"Lettering: {lettering}.",
            f"Finish: {_QUALITY_SPINE}.",
            f"Keep out of the frame: {avoid}.",
        ]
        return "\n".join(lines)

    style_clause = "" if directed else f"Composition and style: {preset['direction']}. "
    return (
        f"{subject}. "
        f"{style_clause}"
        f"Lettering: {lettering}. "
        f"Finish: {_QUALITY_SPINE}. "
        f"Avoid: {avoid}."
    )


class _ImageProviderError(RuntimeError):
    """A rung that failed, carrying what the next decision needs.

    A bare `RuntimeError` told the ladder nothing, so a 429 and a 400 were the
    same event and both were answered the same way: give up on this model and
    pay a dearer one. `status` separates them, and `cost_usd` is set when the
    provider had already generated — and billed for — the picture that was then
    lost, which is the only way that spend can reach `hub_ai_logs`.
    """

    def __init__(self, message: str, *, status: int = 0, cost_usd: float = 0.0,
                 provider: str = "", model: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.cost_usd = cost_usd
        self.provider = provider
        self.model = model


def _is_transient(exc: Exception) -> bool:
    """Is this worth asking the same model again in a second and a half?

    Rate limits and 5xx are; a 400 over an unsupported aspect ratio, a dead
    route answering 410, and our own size cap are not — those return the same
    answer however many times they are asked, and each retry is another round
    trip on a request the customer is waiting on.
    """
    if isinstance(exc, (httpx.TransportError, httpx.TimeoutException)):
        return True
    status = getattr(exc, "status", 0)
    if not status and isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
    return status == 429 or 500 <= int(status or 0) <= 599


#: How many times one rung is asked before the ladder moves on, and how long it
#: waits in between. Two attempts rather than more: this runs inside a request
#: the user is watching, and the rungs below are a fallback, not a failure.
_IMAGE_STEP_ATTEMPTS = 2
_IMAGE_RETRY_DELAY_S = 1.5

#: The two fal routes reachable on the org's HuggingFace key, as
#: `step -> (router path, model string, USD per ~1 MP image)`.
#:
#: Measured 2026-08-19 on that key: `flux/dev` answers 200 in 1,698 ms and
#: `flux/schnell` in 2,158 ms. `hf-inference` answers 410 for every image model,
#: `nebius` 404s and `together` 403s — those are not routes that can be brought
#: back by retrying them.
#:
#: The prices are fal's published per-megapixel rates, NOT measurements: the
#: HuggingFace router returns no cost in the body. They are logged anyway,
#: because a zero would have the spend report call the ladder's busiest steps
#: free — which is how images came to be 79% of the bill unnoticed.
#:
#: What is deliberately NOT claimed here is that schnell's pictures are as good
#: as dev's. That has not been measured on the briefs this file now builds, so
#: dev keeps the lead and schnell sits directly behind it. The point of the
#: order is that the first fallback is CHEAPER than the lead rather than dearer:
#: a rate-limited $0.025 call used to escalate straight to a $0.04 one.
_FAL_ROUTES: dict[str, tuple[str, str, float]] = {
    "fal_flux_dev": ("fal-ai/fal-ai/flux/dev", "fal-ai/flux/dev", 0.025),
    "fal_flux_schnell": ("fal-ai/fal-ai/flux/schnell", "fal-ai/flux/schnell", 0.003),
}

#: One order for every preset.
#:
#: The typographic presets used to lead with Recraft, at $0.04, because it is
#: the only model measured that spells a firm's name letter for letter. Nothing
#: asks any model to spell any more — see the lettering rule in
#: `_build_image_prompt` — so that reason is spent, and it was being paid on
#: `festival_greeting`, the most-posted image this product makes.
_IMAGE_LADDER = ("fal_flux_dev", "fal_flux_schnell", "recraft", "flux2_pro", "gemini_lite")


async def _run_image_step(
    step: str,
    *,
    hf_key: str,
    or_key: str,
    diffusion_prompt: str,
    chat_prompt: str,
    ratio: str,
    width: int,
    height: int,
):
    """One rung of the ladder. `None` means it had no key and was not tried.

    Split out of the loop so that a rung and a RETRY of that rung are literally
    the same call rather than two branches that have to be kept in step.
    """
    if step in _FAL_ROUTES:
        if not hf_key:
            return None
        return await _generate_hf_image(hf_key, diffusion_prompt, width, height, step=step)
    if not or_key:
        return None
    if step == "recraft":
        return await _generate_openrouter_image(
            or_key, diffusion_prompt, ratio, "recraft/recraft-v4")
    if step == "flux2_pro":
        return await _generate_openrouter_image(
            or_key, diffusion_prompt, ratio, "black-forest-labs/flux.2-pro")
    if step == "gemini_lite":
        # The conversational string, because this one reads the brief as copy —
        # see `_build_image_prompt`.
        return await _generate_openrouter_image(
            or_key, chat_prompt, ratio, "google/gemini-3.1-flash-lite-image")
    return None


async def _record_billed_failure(
    pool, *, org_id, provider: str, model: str, cost_usd: float,
    latency_ms: int, error,
) -> None:
    """The row for a rung that was charged for a picture nobody received.

    Written from here rather than through `_record_failure`, which the text path
    owns and which has no cost column in its INSERT: the money is the entire
    point of this row. `generate()` records its failures as well as its
    successes; the image path recorded only the winner, so a run that paid fal
    for an image it could not fetch and then paid Recraft for a replacement
    reported one image at $0.04 and a true cost of $0.065.

    Never allowed to fail the generation. The picture is what the customer was
    charged for, and a bookkeeping row is not worth a 500 on top of a bad
    minute — the row is logged if it cannot be written.
    """
    try:
        await pool.execute(
            "INSERT INTO public.hub_ai_logs "
            "(org_id, provider, model, prompt_tokens, completion_tokens, "
            " latency_ms, status, cost_usd, error_message) "
            "VALUES ($1::uuid, $2, $3, 0, 0, $4, 'error', $5, $6)",
            org_id, provider, model, latency_ms, cost_usd, str(error)[:500],
        )
    except Exception as exc:                                 # pragma: no cover
        log.warning("billed image failure not recorded (%s): %s $%s on %s",
                    exc, provider, cost_usd, model)


async def generate_image(
    prompt: str,
    style: str = "auto",
    aspect_ratio: Optional[str] = None,
    org_id: Optional[str] = None,
    user_id: Optional[str] = None,
    content_type: str = "image",
) -> dict:
    """Generate an image and upload it to R2. Read the block comment above.

    Ladder: `_IMAGE_LADDER` — fal FLUX.1 dev → fal FLUX.1 schnell → Recraft V4 →
    FLUX.2 Pro → Gemini Flash Lite Image → Gemini native (flagged off). `style`
    picks a preset from `_IMAGE_PRESETS`; it used to be accepted and never read.

    `aspect_ratio` defaults to None rather than "1:1" so the preset can choose:
    a blog hero wants 16:9 and a greeting card wants 4:5, and the route the
    Generate tab uses passes no ratio at all. A caller that names one still wins.
    """
    from services.storage import upload_file

    pool = await get_pool()
    result = None
    start = time.monotonic()

    preset_name, preset = _resolve_preset(style)
    ratio = (aspect_ratio or preset["ratio"]).strip()
    width, height = _aspect_dims(ratio)
    diffusion_prompt = _build_image_prompt(prompt, preset)
    chat_prompt = _build_image_prompt(prompt, preset, conversational=True)

    log.info(
        "generate_image: preset=%s ratio=%s (%dx%d) chars=%d hf=%s or=%s",
        preset_name, ratio, width, height, len(diffusion_prompt),
        bool(os.getenv("HF_API_KEY")), bool(os.getenv("OPENROUTER_API_KEY")),
    )

    hf_key = os.getenv("HF_API_KEY", "")
    or_key = os.getenv("OPENROUTER_API_KEY", "")

    for step in _IMAGE_LADDER:
        if result is not None:
            break
        for attempt in range(_IMAGE_STEP_ATTEMPTS):
            try:
                result = await _run_image_step(
                    step, hf_key=hf_key, or_key=or_key,
                    diffusion_prompt=diffusion_prompt, chat_prompt=chat_prompt,
                    ratio=ratio, width=width, height=height,
                )
                break
            except Exception as e:
                # A rung that generated and was BILLED, then lost the picture on
                # the way back, is money already spent. It has to reach
                # `hub_ai_logs` here or nowhere: the success row below records
                # only the winner, so the ladder's whole reason to exist — the
                # spend on the steps that failed — was invisible in a report
                # where images are 79% of lifetime AI cost.
                billed = float(getattr(e, "cost_usd", 0.0) or 0.0)
                if billed:
                    await _record_billed_failure(
                        pool, org_id=org_id,
                        provider=getattr(e, "provider", "") or "unknown",
                        model=getattr(e, "model", "") or step,
                        cost_usd=billed,
                        latency_ms=int((time.monotonic() - start) * 1000),
                        error=e,
                    )
                if attempt + 1 < _IMAGE_STEP_ATTEMPTS and _is_transient(e):
                    # The SAME rung again, not the next one. Escalating on a 429
                    # spends more money to answer a question the lead had not
                    # been asked twice — and every rung below the lead is dearer.
                    log.warning("Image step %s failed transiently (%s), retrying it", step, e)
                    await asyncio.sleep(_IMAGE_RETRY_DELAY_S)
                    continue
                log.warning("Image step %s failed: %s", step, e)
                break

    # Gemini native — OFF by default. See `GEMINI_IMAGE_ENABLED` below.
    #
    # The GEMINI_API_KEY is deliberately scoped to TEXT: chat, grounding and the
    # `text-embedding-004` embeddings in services/rag.py. Google gives no way to
    # restrict a key per-model — chat, images and embeddings all sit behind the
    # single Generative Language API — so the restriction has to live here.
    #
    # This costs almost nothing: it is the fallback of a fallback, reached only
    # when every provider in the ladder above has already failed. Set
    # GEMINI_IMAGE_ENABLED=1 to put it back.
    if result is None and os.getenv("GEMINI_IMAGE_ENABLED", "") == "1":
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        if gemini_key:
            try:
                result = await _generate_gemini_imagen(gemini_key, chat_prompt, ratio)
            except Exception as e:
                log.warning("Gemini Imagen failed: %s", e)

    if result is None:
        raise RuntimeError("All image providers failed")

    latency = int((time.monotonic() - start) * 1000)
    img_bytes = result.pop("image_bytes")
    # The type the provider actually sent, not the type this path used to
    # assume. Naming a WebP `.png` and serving it as `image/png` is how R2 came
    # to hold files whose extension, content type and bytes all disagree.
    mime = result.pop("mime", "") or "image/png"
    ext = _EXT_BY_MIME.get(mime, "png")
    # ── THE PERSON WHO ASKED FOR IT IS RECORDED ON THE FILE ─────────────────
    #
    # This passed `user_id="system"` and `folder="srijan/images"`, so every
    # image any person generated landed in one flat folder under a random
    # filename with the requester recorded nowhere at all — proposal 83's
    # second bug. Nothing could answer "which of these did I make", nothing
    # could clear one person's images when they left, and a shared folder with
    # no owner is a shared folder nobody may safely delete from.
    #
    # `srijan/{content_type}/{user_id}/YYYY/MM/{id}--prompt-slug.png` is the
    # grammar (proposal 83 §4). `user_id` is optional and defaults to None
    # rather than to "system": a caller that has not been threaded yet produces
    # `srijan/{content_type}/YYYY/MM/…`, which is missing the owner and honest
    # about it, where "system" was a lie that read like a fact.
    upload = await upload_file(
        file_bytes=img_bytes,
        # The prompt, slugified, so a key says what the image is. The old name
        # was `srijan-{8 hex}` and answered nothing.
        filename=f"{(prompt or 'image')[:60]}.{ext}",
        content_type=mime,
        user_id=user_id or "",
        module="srijan",
        scope=[content_type],
        org_id=org_id,
    )
    result["image_url"] = upload["url"]
    # The KEY as well as the URL. `upload["url"]` is a presigned R2 link that
    # dies in nine hours; the key is what lets any later read re-sign it. Stored
    # by every caller, so re-signing never has to parse a key back out of an
    # expired URL (`storage.refresh_signed_url`, deprecated for exactly this).
    result["image_key"] = upload.get("key") or ""
    result["mime"] = mime

    await pool.execute(
        "INSERT INTO public.hub_ai_logs "
        "(org_id, provider, model, prompt_tokens, completion_tokens, "
        " latency_ms, status, cost_usd) "
        "VALUES ($1::uuid, $2, $3, 0, 0, $4, 'success', $5)",
        org_id, result["provider"], result["model"], latency, result.get("cost_usd", 0.0),
    )
    if org_id:
        await pool.execute(
            "INSERT INTO public.usage_tracking (org_id, metric, value, recorded_at) "
            "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
            "ON CONFLICT (org_id, metric, recorded_at) "
            "DO UPDATE SET value = public.usage_tracking.value + 1",
            org_id,
        )
    return result


async def _download_image_capped(url: str) -> tuple[bytes, str]:
    """Fetch a generated image, refusing it before it is all in memory.

    See `_MAX_IMAGE_BYTES` and `_FAL_HOSTS` for why both guards are here.
    """
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not any(
        host == h or host.endswith("." + h) for h in _FAL_HOSTS
    ):
        raise RuntimeError(f"refusing to fetch an image from {parts.scheme}://{host}")

    chunks: list[bytes] = []
    total = 0
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            declared = resp.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > _MAX_IMAGE_BYTES:
                raise RuntimeError(f"generated image declares {declared} bytes")
            mime = (resp.headers.get("content-type", "") or "").split(";")[0].strip()
            async for chunk in resp.aiter_bytes(_IMAGE_CHUNK):
                total += len(chunk)
                if total > _MAX_IMAGE_BYTES:
                    raise RuntimeError("generated image exceeded the size cap mid-download")
                chunks.append(chunk)

    return b"".join(chunks), mime or "image/png"


async def _generate_hf_image(
    api_key: str, prompt: str, width: int = 1024, height: int = 1024,
    *, step: str = "fal_flux_dev",
) -> dict:
    """A FLUX.1 route on the HuggingFace router, through the fal-ai provider.

    NOT `hf-inference`. That provider route — which this function used to call —
    answers `410 Gone`, "the requested model is deprecated and no longer
    supported by provider hf-inference", for every image model on the same key.
    `nebius` 404s and `together` 403s. `fal-ai` answers 200 in about two seconds
    and is the only route on this key that still produces an image at all.

    `step` names the route in `_FAL_ROUTES` — dev or schnell. Both are the same
    request against a different path, so they are one function: a second copy is
    a second place for the header, the size guard and the cap to drift.

    It hands back a URL rather than bytes, which is the other difference from
    the old endpoint: the picture has to be fetched, and fetched with a cap.
    """
    path, model, price = _FAL_ROUTES.get(step, _FAL_ROUTES["fal_flux_dev"])
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"https://router.huggingface.co/{path}",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "prompt": prompt,
                # True pixels, not a preset name. This is the only step in the
                # ladder that can be given a frame instead of a hint.
                "image_size": {"width": width, "height": height},
                # Asked for explicitly: the route defaults to JPEG, and a
                # greeting card with flat colour and a headline band is exactly
                # the content JPEG ringing shows on.
                "output_format": "png",
            },
        )
        # The body carries the reason — the retired route's was "the requested
        # model is deprecated and no longer supported by provider hf-inference",
        # which named the fix. A bare 410 in the log named nothing, and this
        # step stayed dead long enough for the lite model to become the default.
        if resp.status_code >= 400:
            raise _ImageProviderError(
                f"fal-ai returned {resp.status_code}: {resp.text[:400]}",
                status=resp.status_code, provider="huggingface", model=model,
            )
        data = resp.json()

    images = data.get("images") or []
    if not images or not images[0].get("url"):
        raise RuntimeError("fal-ai returned no image")

    # PAST THIS POINT THE MEGAPIXEL IS BILLED. fal charges for the generation,
    # not for the download, so anything that goes wrong from here costs the
    # price of a picture nobody received — and the ladder's answer to a failure
    # is to buy another one from a dearer model. So the fetch gets a second
    # attempt of its own on a transient answer, which recovers the image that
    # was already paid for, and the failure that survives that carries its price
    # out with it for `_record_billed_failure` to write down.
    for attempt in range(_IMAGE_STEP_ATTEMPTS):
        try:
            img_bytes, mime = await _download_image_capped(images[0]["url"])
            break
        except Exception as exc:
            if attempt + 1 < _IMAGE_STEP_ATTEMPTS and _is_transient(exc):
                log.warning("fal image fetch failed transiently (%s), refetching", exc)
                await asyncio.sleep(_IMAGE_RETRY_DELAY_S)
                continue
            raise _ImageProviderError(
                f"{model} generated an image that could not be fetched: {exc}",
                cost_usd=price, provider="huggingface", model=model,
            ) from exc

    return {
        "image_bytes": img_bytes,
        "mime": images[0].get("content_type") or mime,
        # STILL `huggingface`, though the route through it changed. The finance
        # console reconciles by exact provider string —
        # `routers/admin_orgs.py::provider_costs` does
        # `tracked_ai.get("huggingface", 0)` — so renaming the code would drop
        # the ladder's LEAD out of the bucket it is reconciled against and show
        # the product's largest image spend as nothing at all. The router and
        # the key are HuggingFace's; the provider route belongs in the model.
        "provider": "huggingface",
        "model": model,
        # fal bills per megapixel through the HuggingFace router and returns no
        # figure in the body, so this is the published rate for a ~1 MP image
        # rather than a measurement — see `_FAL_ROUTES`. It is logged as an
        # estimate on purpose: a zero here would have the spend report call the
        # cheapest steps free.
        "cost_usd": price,
    }


async def _generate_openrouter_image(
    api_key: str,
    prompt: str,
    aspect_ratio: str = "1:1",
    model: str = "black-forest-labs/flux.2-pro",
) -> dict:
    """One of the three OpenRouter image models. The model id is the argument.

    `negative_prompt` is deliberately absent — see `_build_image_prompt`. The
    endpoint accepts the key and answers 200 without documenting the field,
    which is exactly the shape of a parameter that does nothing.
    """
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/images/generations",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "prompt": prompt,
                "n": 1,
                # Snapped, because an unsupported frame is a 400 and not a
                # nudge — see `_OPENROUTER_RATIOS`.
                "aspect_ratio": _openrouter_ratio(aspect_ratio),
                "output_format": "png",
            },
        )
        # The BODY, not just the status. OpenRouter puts the whole reason in it
        # — "aspect_ratio: not supported. Accepted: 1:1, 4:3, 3:4, 16:9, 9:16" —
        # and `raise_for_status()` throws it away, leaving a bare 400 in the log
        # above a rung that silently stopped answering. That is exactly how the
        # dead HuggingFace step went unnoticed: 410 Gone, every call, for weeks.
        if resp.status_code >= 400:
            # The status travels with it as well as in the message: a 429 is
            # worth asking again and a 400 over an unsupported frame is not, and
            # a ladder that cannot tell them apart answers both by buying a
            # dearer picture. See `_is_transient`.
            raise _ImageProviderError(
                f"{model} returned {resp.status_code}: {resp.text[:400]}",
                status=resp.status_code, provider="openrouter", model=model,
            )
        data = resp.json()

    import base64 as b64mod

    item = (data.get("data") or [{}])[0]
    if not item.get("b64_json"):
        raise RuntimeError(f"{model} returned no image")

    # `output_format: "png"` above is a request, not a guarantee: measured
    # 2026-08-19, Recraft V4 answers WebP and the Gemini image model answers
    # JPEG regardless. `media_type` is what actually came back.
    return {
        "image_bytes": b64mod.b64decode(item["b64_json"]),
        "mime": item.get("media_type") or "image/png",
        "provider": "openrouter",
        "model": model,
        "cost_usd": data.get("usage", {}).get("cost", 0.04),
    }


async def _generate_gemini_imagen(api_key: str, prompt: str, aspect_ratio: str = "1:1") -> dict:
    """Generate image via Gemini native image generation (last resort)."""
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent"
    # `x-goog-api-key`, not `?key=` — httpx logs the request URL at INFO, so a
    # key in the query string is written to the deploy log on every call.
    # See services/apify.py for the same fix and the log line that proved it.
    headers = {"x-goog-api-key": api_key}

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, headers=headers, json={
            # The prompt arrives already built for a conversational model, and
            # the aspect ratio has to travel in the words: this API has no
            # dimension field, so a frame nobody names comes back square.
            "contents": [{"parts": [{"text": f"{prompt}\nFrame: {aspect_ratio} aspect ratio."}]}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
        })
        resp.raise_for_status()
        data = resp.json()

    import base64 as b64mod

    for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
        if "inlineData" in part:
            inline = part["inlineData"]
            return {
                "image_bytes": b64mod.b64decode(inline["data"]),
                "mime": inline.get("mimeType") or "image/png",
                "provider": "gemini_native",
                "model": "gemini-2.0-flash-exp",
                "cost_usd": 0.0,
            }

    raise RuntimeError("Gemini returned no image in response")


# ── Rich content generation (text + image in one call) ─────

RICH_CONTENT_MODEL = "google/gemini-3.1-flash-lite-image"
RICH_CONTENT_FALLBACK = "google/gemini-3.1-flash-image"


async def generate_rich_content(
    prompt: str,
    system: str = "",
    max_tokens: int = 4096,
    org_id: Optional[str] = None,
    #: WHO the stored picture belongs to. This parameter did not exist while the
    #: body below already read `user_id` — so the moment the rich model returned
    #: an inline image, the very first thing this function did with it was raise
    #: `NameError: name 'user_id' is not defined`. Nothing calls this route yet,
    #: which is the only reason it has never been seen; `routers/hub.py` imports
    #: the function and the day a route reaches it the failure is total.
    #:
    #: Defaulted to "" rather than to a "system" owner, matching the grammar
    #: `generate_image` already uses: an unowned upload is honest, an upload
    #: attributed to a user who did not ask for it is not.
    user_id: str = "",
) -> dict:
    """Generate rich content with text + image using Gemini's native image model.
    Returns {"text": str, "images": [{"url": str, "mime": str}], ...}."""
    import base64 as b64mod
    from services.storage import upload_file

    or_key = os.getenv("OPENROUTER_API_KEY", "")
    if not or_key:
        raise RuntimeError("OPENROUTER_API_KEY not set")

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    last_error = None
    for model in [RICH_CONTENT_MODEL, RICH_CONTENT_FALLBACK]:
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {or_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": messages,
                        "max_tokens": max_tokens,
                        "temperature": 0.8,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            latency = int((time.monotonic() - start) * 1000)
            choice = data["choices"][0]
            usage = data.get("usage", {})
            cost_usd = float(usage.get("cost", 0) or 0)
            if not cost_usd:
                cost_usd = _estimate_cost(model, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))

            content = choice["message"].get("content", "")
            text_parts = []
            images = []

            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict):
                        if part.get("type") == "text":
                            text_parts.append(part["text"])
                        elif part.get("type") == "image_url":
                            img_url = part.get("image_url", {}).get("url", "")
                            if img_url.startswith("data:"):
                                mime, b64_data = img_url.split(";base64,", 1)
                                mime = mime.replace("data:", "")
                                ext = "png" if "png" in mime else "jpg"
                                img_bytes = b64mod.b64decode(b64_data)
                                # Same grammar as `generate_image` above, and
                                # the same reason: an image returned inline by a
                                # chat completion has an owner too. `user_id`
                                # comes from the call, defaulting to unset
                                # rather than to the "system" that was never
                                # true.
                                upload = await upload_file(
                                    file_bytes=img_bytes,
                                    filename=f"inline-image.{ext}",
                                    content_type=mime,
                                    user_id=user_id or "",
                                    module="srijan",
                                    scope=["inline"],
                                    org_id=org_id,
                                )
                                images.append({"url": upload["url"], "mime": mime})
                            else:
                                images.append({"url": img_url, "mime": "image/png"})
                    elif isinstance(part, str):
                        text_parts.append(part)
            else:
                text_parts.append(str(content))

            pool = await get_pool()
            await pool.execute(
                "INSERT INTO public.hub_ai_logs "
                "(org_id, provider, model, prompt_tokens, completion_tokens, "
                " latency_ms, status, cost_usd, generation_id) "
                "VALUES ($1::uuid, $2, $3, $4, $5, $6, 'success', $7, $8)",
                org_id, "openrouter", model,
                usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
                latency, cost_usd, data.get("id", ""),
            )
            if org_id:
                await pool.execute(
                    "INSERT INTO public.usage_tracking (org_id, metric, value, recorded_at) "
                    "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
                    "ON CONFLICT (org_id, metric, recorded_at) "
                    "DO UPDATE SET value = public.usage_tracking.value + 1",
                    org_id,
                )

            return {
                "text": "\n".join(text_parts),
                "images": images,
                "provider": "openrouter",
                "model": model,
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "cost_usd": cost_usd,
            }

        except Exception as e:
            last_error = e
            log.warning("Rich content model %s failed: %s", model, e)

    # Fallback: generate text + image separately
    log.info("Falling back to separate text + image generation")
    text_result = await generate(prompt=prompt, system=system, max_tokens=max_tokens,
                                  language="en", agent_type="social_media")
    # THE PICTURE GETS A BRIEF OF ITS OWN. It is not the text prompt.
    #
    # This line was the 200-character truncation: `"Create a professional image
    # for: " + prompt[:200]`. It threw away everything past the first two
    # sentences and replaced it with a prefix that describes nothing, so the
    # picture beside the text was generic however specific the request had been.
    #
    # Handing the whole string over instead is not the fix either, and the
    # comment that used to sit here said it was. `generate_image` adds only what
    # is a ROUTER fact — the frame, the lettering rule, the quality spine and
    # the negatives; it does not invent a subject, a setting, a light or a
    # palette, and `prompt` here is the brief written for the LANGUAGE model.
    # "300 words for LinkedIn, professional tone, three hashtags" is an
    # instruction to a writer and noise to an image encoder — "professional" is
    # the first word in `image_brief.SLOP_WORDS` for exactly this reason.
    # `services/image_brief.py` is where a picture's subject comes from, so this
    # path goes through it like every other one. It never raises and it falls
    # back to a deterministic brief when no text key is set.
    from services.image_brief import build_brief

    img_brief = await build_brief(brief=prompt, agent_type="social_media",
                                  org_id=org_id)
    image_result = await generate_image(
        prompt=img_brief.prompt, style=img_brief.style,
        aspect_ratio=img_brief.aspect_ratio, org_id=org_id,
    )
    return {
        "text": text_result["text"],
        "images": [{"url": image_result["image_url"],
                    "mime": image_result.get("mime", "image/png")}],
        "provider": text_result["provider"],
        "model": text_result["model"],
        "prompt_tokens": text_result["prompt_tokens"],
        "completion_tokens": text_result["completion_tokens"],
        "cost_usd": text_result.get("cost_usd", 0) + image_result.get("cost_usd", 0),
    }


# ── Credits: DEPRECATED WRAPPERS OVER services/credits.py ───
#
# Everything below this line used to be money. It is now four wrappers.
#
# Migration 095 collapsed five disagreeing debit implementations into one choke
# point, `services/credits.py`. These four names survive because deleting them
# would mean editing routers this agent does not own, and because
# `tests/test_skill_module_access.py:268-269` asserts BY NAME that `run_skill`
# calls `deduct_credits` and `run_org_skill` calls `deduct_org_credits` before
# it checks module access. The names are load-bearing; the bodies are not.
#
# Do not add logic here. A new caller should call `services.credits` directly:
# it is the only place allowed to name a price or a credit table, and
# `tests/test_credits_isolation.py` walks the tree to prove it.

# DEPRECATED 2026-08-04. This is no longer a price list — the price table that
# migration 095 seeds is, and `credits.price_of` is the only function permitted
# to read it. (The table is not named here, and neither is any other credit
# table: `tests/test_credits_isolation.py` scans file TEXT, so a name in a
# comment is as much of a second reference as a name in a query.) The dict is
# kept BOUND, with its values untouched, for exactly two importers:
# `tests/test_credit_refund.py` and `tests/test_skill_template_validation.py:229`
# (which asserts a template estimate equals this dict's "email" entry).
#
# It was never a price list in the honest sense anyway: every call site read it
# through `.get(agent_type, 2)`, so a kind nobody had listed — "chatbot",
# "content" — silently cost 2 credits and looked deliberate. That fallback is
# what `credits.UnknownPrice` now refuses to do.
CREDIT_COSTS = {
    "social_media": 2,
    "blog": 5,
    "ad_copy": 3,
    "email": 2,
    "whatsapp": 1,
    "lead_magnet": 8,
    "campaign": 10,
    "seo": 8,
    "ad_analysis": 5,
    "image": 3,
}

# DEPRECATED 2026-08-04. The rupees-per-credit figure moved to
# `services/credits.py` with `price_of_scraper_usage`, which is the one function
# that multiplies it by a forex rate and an org markup. Kept bound only until
# `routers/scrapers.py:100` stops importing it from here.
CREDIT_PRICE_INR = 4


def _no_idempotency_key(scope: str) -> str:
    """A fresh key on every call — which is to say NO idempotency at all.

    Stated plainly rather than hidden, because `credits.spend` REQUIRES a key and
    a wrapper that invented a deterministic one would be worse than useless. The
    only identifiers these wrappers receive are `(org_id, user_id, agent_type)`,
    and two legitimate generations of the same kind by the same person a minute
    apart must both be charged. A key built from those three would collapse the
    second into a replay and silently under-bill.

    So a retry through a wrapper charges twice — exactly as it did before 095.
    That is not a regression; it is the reason these wrappers are deprecated. A
    caller that can name its unit of work (`skillrun:{run_id}:step:{n}`,
    `scraper:{run_id}:min`, `gen:{org}:{request_id}`) must call `credits.spend`
    directly and get the guarantee.
    """
    return f"legacy:{scope}:{uuid.uuid4().hex}"


async def deduct_credits(client_id: str, agent_type: str, user_id: str = None) -> int:
    """DEPRECATED wrapper. Charges the ORG, not the per-client wallet.

    This function used to be the fifth debit implementation, and the only one
    that spent `staging.hub_credit_wallets` — a per-CLIENT wallet with 53 rows
    that nothing else in the product can see. The balance every other path reads,
    every report totals and every invoice bills is the ORG wallet. So a
    generation booked through a client route came out of one pot while the
    customer was shown, charged for, and topped up another. The top-up form in
    the frontend writes the client wallet, which is why topping up has been
    raising the spendable balance by zero.

    It now charges the org, resolving the org the way `generate()` already does
    (see `client_id` handling above) with one lookup on `staging.hub_clients`.

    BEHAVIOUR CHANGE, deliberate and worth saying out loud: the 53 per-client
    balances become unspendable. Some of them are non-zero. Per the owner the
    table and its rows are retained — nothing here drops or zeroes them — but a
    client that could generate yesterday against a client-wallet balance now
    needs org credits. That is the point of the programme; it is not a side
    effect of it.

    Everything charged through here is booked as `kind='content'`, because three
    arguments is all the wrapper gets — a step of `run_skill` is indistinguishable
    from a one-off generation from in here. So `usage_summary`'s `by_kind` will
    under-count `skill_step` until the caller passes `credits.spend` its own kind.
    The money is right either way; only the breakdown is coarse.

    Returns the new ORG balance. Raises 402/404 through `services.credits`.
    """
    # Imported inside the function, matching the `HTTPException` and
    # `services.storage` imports above: `credits` is landing in this same
    # programme and a module-level import would make every router in the product
    # fail to load if it were a minute behind.
    from fastapi import HTTPException
    from services import credits

    pool = await get_pool()
    org_id = await pool.fetchval(
        "SELECT org_id FROM public.hub_clients WHERE id=$1::uuid", client_id
    )
    if not org_id:
        # Was "Credit wallet not found", which named the wrong thing even before
        # 095: the wallet was missing because the client was.
        raise HTTPException(404, "Client not found")

    receipt = await credits.spend_standalone(
        org_id=str(org_id),
        user_id=user_id,
        kind="content",
        ref_id=agent_type,
        idempotency_key=_no_idempotency_key("client"),
        description=f"{agent_type} generation",
    )
    return receipt.balance_after


async def _maybe_reset_monthly_credits(conn, org_id: str):
    """DEPRECATED wrapper over `credits.roll_period`.

    What this used to do, and why none of it survives:

      · `SET balance = $1` — it OVERWROTE the balance with the month's grant, so
        a top-up the client had been invoiced for was annihilated at the roll and
        the ledger row called it a 'reset'. `roll_period` sets the ALLOWANCE
        bucket and leaves PURCHASED alone; that is the whole two-bucket model.
      · `if not org_credits: <fall through to the plan default>` — a deliberately
        negotiated 0 is falsy, so an org Aekam had agreed to give nothing was
        handed the plan's default credits every single month.
        `organisations.monthly_credits` is now the sole source and 0 means 0.
      · it took NO ROW LOCK and ran before the caller's `FOR UPDATE`, so two
        first-of-month spends could each roll the period.

    That last one is worth being explicit about, because the two legacy callers
    (`routers/hub.py`, `routers/scrapers.py`) hand over a connection with no lock
    on the wallet row and this wrapper does not take one either. It does not need
    to: `roll_period` takes the row lock itself precisely "so a caller cannot
    forget", and it heals a missing wallet row on the way through — which is what
    stops an org created with 0 credits answering 402 forever. Adding a second
    lock here would be a redundant round trip on a path that `GET /hub/org/credits`
    hits on every read.

    Runs inside the CALLER'S transaction, as it always has, so a caller that
    rolls back un-rolls the period with it.
    """
    from services import credits

    await credits.roll_period(conn, org_id)


async def refund_org_credits(org_id: str, user_id: str, agent_type: str, description: str = "") -> int:
    """DEPRECATED wrapper over `credits.refund`. Put back what a failure charged.

    The reason this exists at all is unchanged and still true: every caller that
    spends before it generates — all three image sites — was charging for a
    failure. The deduction commits, `generate_image` raises, the `except` writes a
    log line, and the credits are gone with no image. HuggingFace sits first in
    the image chain and has answered `410 Gone` on every call since its
    serverless route for FLUX.1-dev was retired; the chain survives only because
    OpenRouter is behind it.

    What changed is that it no longer moves money and no longer guesses an
    amount. The old signature named an AGENT TYPE, never a transaction, so it
    could only ever return that type's LIST price — not what was actually
    charged, and never a trued-up scraper run, which has no agent type at all.
    `credits.latest_spend_id` turns the agent type back into the transaction it
    almost certainly meant, and `credits.refund` returns the real amount to the
    bucket it came from, decrements the member's period spend, and is
    refund-once by a unique index rather than by hope.

    "Almost certainly" is the honest word: two concurrent runs of the same kind
    by the same person are indistinguishable from here, so a failure may reverse
    the sibling's row. Both cost the same, so the balance lands in the right
    place and only the attribution is wrong — and a caller that wants the right
    row calls `credits.refund(tx_id=…)` with the id its own spend returned. That
    is the whole argument for deprecating this signature.

    Matched on `ref_id` alone, not on `kind`, so a refund reaches a step charged
    as `skill_step` as readily as one charged as `content`. Rows written before
    095 carry neither column and cannot be matched — which costs nothing, because
    a refund follows its charge by seconds inside one request, and no charge made
    after this deploy is a pre-095 row.

    Still NEVER RAISES. It runs inside an `except` that is already handling a
    failure, and a refund that throws would replace a lost 3 credits with a 500
    for a user who is waiting on text that already generated. A refund it cannot
    place returns 0 and says so in the log, exactly as a missing wallet always
    did.
    """
    from datetime import datetime, timedelta, timezone

    from services import credits

    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            # A refund is written in the `except` of the call that failed, so it
            # follows its charge by seconds. A day is already absurdly generous,
            # and the bound is what stops this reaching into a closed month.
            tx_id = await credits.latest_spend_id(
                conn, org_id,
                user_id=user_id,
                ref_id=agent_type,
                since=datetime.now(timezone.utc) - timedelta(days=1),
            )

        if not tx_id:
            log.warning(
                "No matching %s debit to refund for org %s user %s — "
                "call credits.refund(tx_id) with the id spend() returned",
                agent_type, org_id, user_id,
            )
            return 0

        receipt = await credits.refund_standalone(
            tx_id=tx_id,
            reason=description or f"Refund — {agent_type} did not complete",
            user_id=user_id,
        )
        # `refund_standalone` already swallows its own failures and returns None,
        # logging what the customer is owed. Mirror the old contract: 0.
        return receipt.balance_after if receipt else 0
    except Exception as exc:
        log.warning("Credit refund failed for org %s (%s): %s", org_id, agent_type, exc)
        return 0


async def deduct_org_credits(org_id: str, user_id: str, agent_type: str, description: str = "") -> int:
    """DEPRECATED wrapper over `credits.spend_standalone`. Returns the new balance.

    Everything this used to do by hand is now `credits.spend`, and every one of
    those hand-rolled steps was wrong in a way that cost somebody money:

      · it opened ITS OWN pool connection and committed on its own, so a caller
        that raised afterwards — `routers/hub.py` does, twice — left a committed
        debit with nothing to reverse it. `spend()` requires the caller's
        connection for exactly that reason; this wrapper cannot supply one, which
        is why it uses `spend_standalone` and why converted callers must not.
      · it locked the member allocation row and THEN the org wallet row, while
        `refund_org_credits` locked them the other way round — two tables, one
        org, opposite orders, one concurrent debit-and-refund away from a
        deadlock. The house order is org row first, always.
      · it treated the member allocation as a SECOND WALLET to debit. It is a
        CEILING on the shared org balance; nothing is ever taken from a member.
      · it priced the work out of the legacy dict below through a two-credit
        default, so an unlisted kind cost 2 credits by accident and looked
        deliberate in the ledger.
      · no idempotency of any sort — see `_no_idempotency_key`.

    Signature and name are unchanged on purpose: `test_skill_module_access.py`
    asserts by source order that `run_org_skill` checks module access before it
    reaches this call.
    """
    from services import credits

    receipt = await credits.spend_standalone(
        org_id=org_id,
        user_id=user_id,
        kind="content",
        ref_id=agent_type,
        idempotency_key=_no_idempotency_key("org"),
        description=description or f"{agent_type} generation",
    )
    return receipt.balance_after
