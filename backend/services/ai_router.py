"""
ai_router.py — Smart multi-provider AI routing for Sahayak (सहायक).
Routes by language + task type:
  - Indic languages → Gemini 2.5 Flash Lite (free, strong Indic support)
  - English bulk (social, ads) → GLM-4.5-Air (free)
  - English quality (blog, email, lead magnet) → Qwen3.6 Flash
  - Chatbot/RAG → Qwen3.5 Plus
  - Premium (campaign/SEO) → Gemini 2.5 Pro
  - Fallback chain → Gemini Flash → Groq Llama

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
        "FROM staging.hub_ai_providers WHERE is_active=TRUE ORDER BY priority"
    )
    _providers_cache = {r["code"]: dict(r) for r in rows}
    return _providers_cache


def clear_provider_cache():
    global _providers_cache
    _providers_cache = None


def _select_providers(language: str = "en", agent_type: str = "social_media", task: str = "content") -> list[str]:
    """Return ordered list of provider codes based on language, agent type, and task.

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
    # Campaign & SEO — always use best model regardless of language
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
        if language in INDIC_LANGS:
            return ["gemini_flash_or", "gemini_lite_or", "qwen_plus", "groq"]
        return ["glm", "qwen_plus", "qwen_flash", "gemini_lite_or", "groq"]

    if language in INDIC_LANGS:
        if agent_type in QUALITY_AGENTS:
            return ["gemini_flash_or", "gemini_lite_or", "qwen_flash", "groq"]
        return ["gemini_lite_or", "gemini_flash_or", "qwen_flash", "groq"]

    if agent_type in QUALITY_AGENTS:
        return ["qwen_flash", "glm", "groq"]

    # English bulk (social_media, ad_copy, whatsapp)
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
        "INSERT INTO staging.hub_ai_logs "
        "(client_id, org_id, provider, model, prompt_tokens, completion_tokens, "
        " latency_ms, status, cost_usd, generation_id) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'success', $8, $9)",
        client_id, org_id, code, model,
        result["prompt_tokens"], result["completion_tokens"],
        latency_ms, cost_usd, result.get("generation_id", ""),
    )
    if client_id:
        _org_id = await pool.fetchval(
            "SELECT org_id FROM staging.hub_clients WHERE id=$1::uuid", client_id
        )
        if _org_id:
            await pool.execute(
                "INSERT INTO staging.usage_tracking (org_id, metric, value, recorded_at) "
                "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
                "ON CONFLICT (org_id, metric, recorded_at) "
                "DO UPDATE SET value = staging.usage_tracking.value + 1",
                _org_id,
            )


async def _record_failure(pool, *, code, model, client_id, org_id, latency_ms, error) -> None:
    """The error row. The failures matter as much as the successes: a provider
    ahead of the working one in the chain charges every call its round trip.
    Two of them were 400ing on every request as of 2026-07-29."""
    await pool.execute(
        "INSERT INTO staging.hub_ai_logs "
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

async def generate_image(
    prompt: str,
    style: str = "auto",
    aspect_ratio: str = "1:1",
    org_id: Optional[str] = None,
) -> dict:
    """Generate image via: HuggingFace → Gemini Flash Image → FLUX.2 Pro → Recraft → Gemini native. Uploads to R2."""
    import base64 as b64mod
    from services.storage import upload_file

    pool = await get_pool()
    result = None
    start = time.monotonic()
    log.info("generate_image: prompt=%s, hf=%s, or=%s", prompt[:60], bool(os.getenv("HF_API_KEY")), bool(os.getenv("OPENROUTER_API_KEY")))

    # 1. HuggingFace Flux Dev (free, high quality)
    hf_key = os.getenv("HF_API_KEY", "")
    if hf_key and result is None:
        try:
            result = await _generate_hf_image(hf_key, prompt)
        except Exception as e:
            log.warning("HuggingFace Flux Dev failed: %s", e)

    # 2. OpenRouter Gemini Flash Image (cheap, good quality)
    or_key = os.getenv("OPENROUTER_API_KEY", "")
    if or_key and result is None:
        try:
            result = await _generate_openrouter_image(or_key, prompt, aspect_ratio, "google/gemini-3.1-flash-lite-image")
        except Exception as e:
            log.warning("OpenRouter Gemini Flash Image failed: %s", e)

    # 3. OpenRouter FLUX.2 Pro (high quality)
    if or_key and result is None:
        try:
            result = await _generate_openrouter_image(or_key, prompt, aspect_ratio, "black-forest-labs/flux.2-pro")
        except Exception as e:
            log.warning("OpenRouter FLUX.2 Pro failed: %s", e)

    # 4. OpenRouter Recraft V4 (good for marketing/design)
    if or_key and result is None:
        try:
            result = await _generate_openrouter_image(or_key, prompt, aspect_ratio, "recraft/recraft-v4")
        except Exception as e:
            log.warning("OpenRouter Recraft V4 failed: %s", e)

    # 5. Gemini native — OFF by default. See `GEMINI_IMAGE_ENABLED` below.
    #
    # The GEMINI_API_KEY is deliberately scoped to TEXT: chat, grounding and the
    # `text-embedding-004` embeddings in services/rag.py. Google gives no way to
    # restrict a key per-model — chat, images and embeddings all sit behind the
    # single Generative Language API — so the restriction has to live here.
    #
    # This costs almost nothing: it is the fallback of a fallback, reached only
    # when all three OpenRouter providers above have already failed. Set
    # GEMINI_IMAGE_ENABLED=1 to put it back.
    if result is None and os.getenv("GEMINI_IMAGE_ENABLED", "") == "1":
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        if gemini_key:
            try:
                result = await _generate_gemini_imagen(gemini_key, prompt, aspect_ratio)
            except Exception as e:
                log.warning("Gemini Imagen failed: %s", e)

    if result is None:
        raise RuntimeError("All image providers failed")

    latency = int((time.monotonic() - start) * 1000)
    img_bytes = b64mod.b64decode(result["image_b64"])
    upload = await upload_file(
        file_bytes=img_bytes,
        filename=f"srijan-{uuid.uuid4().hex[:8]}.png",
        content_type="image/png",
        user_id="system",
        folder="srijan/images",
        org_id=org_id,
    )
    result["image_url"] = upload["url"]
    # The KEY as well as the URL. `upload["url"]` is a presigned R2 link that
    # dies in nine hours; the key is what lets any later read re-sign it. Stored
    # by every caller, so re-signing never has to parse a key back out of an
    # expired URL (`storage.refresh_signed_url`, deprecated for exactly this).
    result["image_key"] = upload.get("key") or ""
    del result["image_b64"]

    await pool.execute(
        "INSERT INTO staging.hub_ai_logs "
        "(org_id, provider, model, prompt_tokens, completion_tokens, "
        " latency_ms, status, cost_usd) "
        "VALUES ($1::uuid, $2, $3, 0, 0, $4, 'success', $5)",
        org_id, result["provider"], result["model"], latency, result.get("cost_usd", 0.0),
    )
    if org_id:
        await pool.execute(
            "INSERT INTO staging.usage_tracking (org_id, metric, value, recorded_at) "
            "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
            "ON CONFLICT (org_id, metric, recorded_at) "
            "DO UPDATE SET value = staging.usage_tracking.value + 1",
            org_id,
        )
    return result


async def _generate_hf_image(api_key: str, prompt: str) -> dict:
    """Generate image via HuggingFace Inference API — Flux Dev (free tier)."""
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-dev",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"inputs": prompt},
        )
        resp.raise_for_status()
        img_bytes = resp.content

    import base64 as b64mod
    return {
        "image_b64": b64mod.b64encode(img_bytes).decode(),
        "provider": "huggingface",
        "model": "FLUX.1-dev",
        "cost_usd": 0.0,
    }


async def _generate_openrouter_image(api_key: str, prompt: str, aspect_ratio: str = "1:1", model: str = "black-forest-labs/flux-pro-1.1") -> dict:
    """Generate image via OpenRouter Images API — Flux Pro or Ideogram."""
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/images/generations",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "prompt": prompt,
                "n": 1,
                "aspect_ratio": aspect_ratio,
                "output_format": "png",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    b64 = data["data"][0]["b64_json"]
    cost = data.get("usage", {}).get("cost", 0.04)
    return {
        "image_b64": b64,
        "provider": f"openrouter",
        "model": model,
        "cost_usd": cost,
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
            "contents": [{"parts": [{"text": f"Generate an image: {prompt}"}]}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
        })
        resp.raise_for_status()
        data = resp.json()

    for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
        if "inlineData" in part:
            b64 = part["inlineData"]["data"]
            return {
                "image_b64": b64,
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
                                upload = await upload_file(
                                    file_bytes=img_bytes,
                                    filename=f"srijan-{uuid.uuid4().hex[:8]}.{ext}",
                                    content_type=mime,
                                    user_id="system",
                                    folder="srijan/images",
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
                "INSERT INTO staging.hub_ai_logs "
                "(org_id, provider, model, prompt_tokens, completion_tokens, "
                " latency_ms, status, cost_usd, generation_id) "
                "VALUES ($1::uuid, $2, $3, $4, $5, $6, 'success', $7, $8)",
                org_id, "openrouter", model,
                usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
                latency, cost_usd, data.get("id", ""),
            )
            if org_id:
                await pool.execute(
                    "INSERT INTO staging.usage_tracking (org_id, metric, value, recorded_at) "
                    "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
                    "ON CONFLICT (org_id, metric, recorded_at) "
                    "DO UPDATE SET value = staging.usage_tracking.value + 1",
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
    image_result = await generate_image(prompt=f"Create a professional image for: {prompt[:200]}",
                                         org_id=org_id)
    return {
        "text": text_result["text"],
        "images": [{"url": image_result["image_url"], "mime": "image/png"}],
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
        "SELECT org_id FROM staging.hub_clients WHERE id=$1::uuid", client_id
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
